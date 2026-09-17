[CmdletBinding()]
param(
    [ValidateRange(0, 3600)]
    [int]$WarmupSeconds = 10,

    [ValidateRange(1, 86400)]
    [int]$DurationSeconds = 60,

    [ValidateRange(1024, 65531)]
    [int]$BaseCdpPort = 9333,

    [string]$BaseUrl = "http://127.0.0.1:4173",

    [string]$OutputRoot = ".test-output\benchmarks",

    [switch]$Diagnostics,

    [ValidateSet('all', 'churn')]
    [string]$Workload = 'all',

    [switch]$Compact,

    [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$baseUri = [Uri]$BaseUrl
if (-not $baseUri.IsAbsoluteUri -or $baseUri.Scheme -notin @("http", "https")) {
    throw "BaseUrl must be an absolute HTTP(S) URL"
}
$baseUrlNormalized = $BaseUrl.TrimEnd([char[]]"/")
$outputBase = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
    [System.IO.Path]::GetFullPath($OutputRoot)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputRoot))
}
$runName = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ") + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runDirectory = Join-Path $outputBase $runName
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
. (Join-Path $PSScriptRoot 'compact-run.ps1')
$resultsScript = Join-Path $PSScriptRoot 'run-results.mjs'

$tsxPackage = Join-Path $repoRoot "node_modules\tsx\package.json"
if (-not (Test-Path -LiteralPath $tsxPackage -PathType Leaf)) {
    throw "Missing $tsxPackage. Install dependencies before running benchmarks."
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd is not available on PATH"
}
$node = (Get-Command node.exe -ErrorAction Stop).Source

$managedEnvironment = @(
    "NGNE_URL",
    "NGNE_WARMUP_SECONDS",
    "NGNE_DURATION_SECONDS",
    "NGNE_CDP_PORT",
    "NGNE_SERVE_DIR",
    "NGNE_SERVE_OUT_DIR",
    "NGNE_EXPECTED_BUILD",
    "NGNE_EXPECTED_BACKEND",
    "NGNE_ALLOCATION_SAMPLING",
    "NGNE_CYCLES",
    "NGNE_SNAPSHOTS",
    "NGNE_TRACE",
    "NGNE_RETAINED_EVERY_SECONDS",
    "NGNE_ARTIFACT_DIR"
)
$savedEnvironment = @{}
foreach ($name in $managedEnvironment) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$stages = [System.Collections.Generic.List[object]]::new()
$runStartedAt = [DateTime]::UtcNow.ToString("o")
$fatalError = $null
$overallExitCode = 0
$originalLocation = Get-Location

function Write-Utf8File {
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, $script:utf8NoBom)
}

function Convert-LinesToText {
    param([object[]]$Lines)
    if (-not $Lines -or $Lines.Count -eq 0) {
        return ""
    }
    return (($Lines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine) +
        [Environment]::NewLine
}

function Set-BenchmarkEnvironment {
    param([hashtable]$Values)
    foreach ($name in $script:managedEnvironment) {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
    foreach ($entry in $Values.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
    }
}

function Invoke-LoggedStage {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList
    )
    $stageDirectory = Join-Path $script:runDirectory $Name
    New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null
    $logPath = Join-Path $stageDirectory "run.log"
    $startedAt = [DateTime]::UtcNow.ToString("o")
    Write-Host "`n[$Name] $FilePath $($ArgumentList -join ' ')" -ForegroundColor Cyan
    $output = @(& $FilePath @ArgumentList 2>&1)
    $exitCode = $LASTEXITCODE
    $text = Convert-LinesToText $output
    Write-Utf8File $logPath $text
    if ($text) {
        Write-Host $text.TrimEnd()
    }
    return [pscustomobject][ordered]@{
        name = $Name
        kind = "command"
        status = if ($exitCode -eq 0) { "passed" } else { "failed" }
        exitCode = $exitCode
        startedAt = $startedAt
        finishedAt = [DateTime]::UtcNow.ToString("o")
        command = "$FilePath $($ArgumentList -join ' ')"
        resultPath = $null
        logPath = $logPath
        artifactDirectory = $stageDirectory
        url = $null
    }
}

function Invoke-JsonStage {
    param(
        [string]$Name,
        [string]$ScriptPath,
        [AllowNull()][string]$Url,
        [string]$ChurnMode = ''
    )
    $stageDirectory = Join-Path $script:runDirectory $Name
    New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null
    $resultPath = Join-Path $stageDirectory "result.json"
    $logPath = Join-Path $stageDirectory "run.log"
    $startedAt = [DateTime]::UtcNow.ToString("o")
    if ($Url) {
        Write-Host "`n[$Name] sampling; keep the Chrome benchmark tab visible" -ForegroundColor Cyan
    } else {
        Write-Host "`n[$Name] sampling" -ForegroundColor Cyan
    }
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $script:node
    $startInfo.Arguments = "--import tsx `"$ScriptPath`""
    if ($ChurnMode) {
        $startInfo.Arguments += " $ChurnMode --out `"$resultPath`""
        if ($ChurnMode -eq 'alloc') {
            $startInfo.Arguments = '--expose-gc ' + $startInfo.Arguments + " --profile `"$(Join-Path $stageDirectory 'allocation.heapprofile')`""
        }
        if ($ChurnMode -eq 'gc') { $startInfo.Arguments = '--trace-gc ' + $startInfo.Arguments }
    }
    $startInfo.WorkingDirectory = $script:repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Unable to start benchmark process for $Name"
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $resultText = $stdoutTask.Result
    $logText = $stderrTask.Result
    $exitCode = $process.ExitCode
    $process.Dispose()
    if ($ChurnMode) {
        Write-Utf8File (Join-Path $stageDirectory 'stdout.log') $resultText
        $resultText = if (Test-Path -LiteralPath $resultPath) { Get-Content -LiteralPath $resultPath -Raw } else { '' }
    } else { Write-Utf8File $resultPath $resultText }
    Write-Utf8File $logPath $logText
    if ($logText) {
        Write-Host $logText.TrimEnd()
    }
    $validationError = $null
    if ($exitCode -eq 0) {
        try {
            $null = $resultText | ConvertFrom-Json -ErrorAction Stop
            if ($ChurnMode) {
                if ($logText) { throw 'Churn emitted stderr' }
                $parsedPath = Join-Path $stageDirectory 'gc-parsed.json'
                if ($ChurnMode -eq 'gc') {
                    & $script:node (Join-Path $PSScriptRoot 'cpu/churn-gc-parse.mjs') (Join-Path $stageDirectory 'stdout.log') $resultPath $parsedPath > (Join-Path $stageDirectory 'parser.log')
                    if ($LASTEXITCODE -ne 0) { throw 'GC trace parser rejected the run' }
                }
                & $script:node $script:resultsScript validate-churn $resultPath $ChurnMode $parsedPath
                if ($LASTEXITCODE -ne 0) { throw 'Churn result validation failed' }
            }
        } catch {
            $validationError = "Result validation failed: $($_.Exception.Message)"
            $exitCode = 1
            [System.IO.File]::AppendAllText(
                $logPath,
                $validationError + [Environment]::NewLine,
                $script:utf8NoBom
            )
        }
    }
    return [pscustomobject][ordered]@{
        name = $Name
        kind = "benchmark"
        status = if ($exitCode -eq 0) { "passed" } else { "failed" }
        exitCode = $exitCode
        startedAt = $startedAt
        finishedAt = [DateTime]::UtcNow.ToString("o")
        command = "$($script:node) $($startInfo.Arguments)"
        resultPath = $resultPath
        logPath = $logPath
        artifactDirectory = $stageDirectory
        url = $Url
        validationError = $validationError
    }
}

function Write-Reports {
    $revision = "unknown"
    $revisionOutput = @(& git rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $revisionOutput.Count) {
        $revision = [string]$revisionOutput[0]
    }
    $failedStages = @($script:stages | Where-Object { $_.status -eq "failed" })
    $status = if ($script:fatalError -or $failedStages.Count) { "failed" } else { "passed" }
    $manifest = [ordered]@{
        schemaVersion = 2
        status = $status
        startedAt = $script:runStartedAt
        finishedAt = [DateTime]::UtcNow.ToString("o")
        revision = $revision
        parameters = [ordered]@{
            warmupSeconds = $WarmupSeconds
            durationSeconds = $DurationSeconds
            baseUrl = $BaseUrl
            baseCdpPort = $BaseCdpPort
            diagnostics = [bool]$Diagnostics
            skipBuild = [bool]$SkipBuild
            workload = $Workload
        }
        environment = [ordered]@{
            powershell = $PSVersionTable.PSVersion.ToString()
            os = [Environment]::OSVersion.VersionString
            machine = [Environment]::MachineName
        }
        outputDirectory = $script:runDirectory
        fatalError = $script:fatalError
        retention = @{ mode = 'full'; compactRequested = [bool]$Compact; rawEvidenceAvailable = $true }
        stages = $script:stages.ToArray()
    }
    $manifestPath = Join-Path $script:runDirectory "manifest.json"
    Write-Utf8File $manifestPath (($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine)

    $summary = [System.Collections.Generic.List[string]]::new()
    [void]$summary.Add("# NGNE benchmark run")
    [void]$summary.Add("")
    [void]$summary.Add("- Status: **$status**")
    [void]$summary.Add("- Revision: ``$revision``")
    [void]$summary.Add("- Started: $($script:runStartedAt)")
    [void]$summary.Add("- Workload: $Workload")
    if ($Workload -eq 'all') { [void]$summary.Add("- Browser warmup/sample: $WarmupSeconds s / $DurationSeconds s") }
    [void]$summary.Add("- Diagnostics: $([bool]$Diagnostics)")
    if ($script:fatalError) {
        [void]$summary.Add("- Fatal error: $($script:fatalError)")
    }
    [void]$summary.Add("")
    [void]$summary.Add("[Measurements and provenance](analysis.json)")
    [void]$summary.Add("")
    [void]$summary.Add("| Stage | Status |")
    [void]$summary.Add("| --- | --- |")
    foreach ($stage in $script:stages) {
        [void]$summary.Add("| $($stage.name) | $($stage.status) |")
    }
    [void]$summary.Add("")
    [void]$summary.Add(
        "Renderer timings are CPU preparation/submission evidence only; they do not wait for GPU completion."
    )
    $summaryPath = Join-Path $script:runDirectory "summary.md"
    Write-Utf8File $summaryPath (($summary -join [Environment]::NewLine) + [Environment]::NewLine)
    & $script:node $script:resultsScript collect $script:runDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Unable to consolidate benchmark results; artifacts retained' }
    $analysis = Get-Content -LiteralPath (Join-Path $script:runDirectory 'analysis.json') -Raw | ConvertFrom-Json
    $timed = @($analysis.stages | Where-Object { $_.name -eq 'churn' -and $_.status -eq 'passed' })
    if ($timed.Count) {
        $ms = $timed[0].result.batchMs
        $line = "`nChurn batch p50/p95/p99: $([Math]::Round($ms.p50, 3)) / $([Math]::Round($ms.p95, 3)) / $([Math]::Round($ms.p99, 3)) ms. One run is not an A/B verdict.`n"
        [IO.File]::AppendAllText($summaryPath, $line, $script:utf8NoBom)
    }
    if ($Compact -and $status -eq 'passed') {
        Compress-BenchmarkRun -RunDirectory $script:runDirectory -ResultsScript $script:resultsScript -Node $script:node
    }
}

Push-Location $repoRoot
try {
    Write-Host "NGNE benchmark run: $runDirectory" -ForegroundColor Green
    if ($Workload -eq 'all') { Write-Host "Browser runs are sequential. Keep each Chrome benchmark tab visible and unminimized." }

    if ($Workload -eq 'all') {
        if ($SkipBuild) {
            if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "dist\index.html"))) {
                throw "-SkipBuild requires an existing production build under dist"
            }
            if (-not (Test-Path -LiteralPath (Join-Path $repoRoot "dist-browser\benchmarks\browser\index.html"))) {
                throw "-SkipBuild requires an existing browser benchmark build under dist-browser"
            }
        } else {
            $productionBuild = Invoke-LoggedStage "build-production" "npm.cmd" @("run", "build")
            [void]$stages.Add($productionBuild)
            if ($productionBuild.status -eq "failed") {
                throw "Production build failed"
            }
            $browserBuild = Invoke-LoggedStage "build-browser" "npm.cmd" @("run", "build:browser")
            [void]$stages.Add($browserBuild)
            if ($browserBuild.status -eq "failed") {
                throw "Browser build failed"
            }
        }

        $cpu = Invoke-JsonStage "cpu" "benchmarks/cpu/benchmark.ts" $null
        [void]$stages.Add($cpu)
        if ($cpu.status -eq "failed") {
            $overallExitCode = 1
        }
    }

    $churnModes = @('timed')
    if ($Diagnostics) { $churnModes += @('alloc', 'gc') }
    foreach ($mode in $churnModes) {
        $name = if ($mode -eq 'timed') { 'churn' } else { "churn-$mode" }
        $result = Invoke-JsonStage $name 'benchmarks/cpu/churn-schema.ts' $null $mode
        [void]$stages.Add($result)
        if ($result.status -eq 'failed') { $overallExitCode = 1 }
    }

    if ($Workload -eq 'all') {
        $browserRuns = @(
            [ordered]@{
                name = "renderer-webgpu"
                url = "$baseUrlNormalized/benchmarks/browser/index.html?workload=renderer-webgpu"
                outDir = "dist-browser"
            },
            [ordered]@{
                name = "renderer-webgpu-alternating"
                url = "$baseUrlNormalized/benchmarks/browser/index.html?workload=renderer-webgpu&alternating=1"
                outDir = "dist-browser"
            },
            [ordered]@{
                name = "starfall-chaos"
                url = "$baseUrlNormalized/"
                outDir = "dist"
            },
            [ordered]@{
                name = "platformer"
                url = "$baseUrlNormalized/examples/platformer/?baseline"
                outDir = "dist"
            }
        )

        for ($index = 0; $index -lt $browserRuns.Count; $index++) {
            $run = $browserRuns[$index]
            $artifactDirectory = Join-Path $runDirectory $run.name
            $environment = @{
                NGNE_URL = $run.url
                NGNE_WARMUP_SECONDS = $WarmupSeconds
                NGNE_DURATION_SECONDS = $DurationSeconds
                NGNE_CDP_PORT = $BaseCdpPort + $index
                NGNE_SERVE_DIR = $repoRoot
                NGNE_SERVE_OUT_DIR = $run.outDir
                NGNE_EXPECTED_BUILD = Join-Path $repoRoot $run.outDir
                NGNE_EXPECTED_BACKEND = "webgpu"
                NGNE_ARTIFACT_DIR = $artifactDirectory
            }
            if ($Diagnostics) {
                $environment.NGNE_ALLOCATION_SAMPLING = "1"
                $environment.NGNE_SNAPSHOTS = "1"
                $environment.NGNE_TRACE = "1"
            }
            Set-BenchmarkEnvironment $environment
            $result = Invoke-JsonStage $run.name "benchmarks/browser/browser-baseline.ts" $run.url
            [void]$stages.Add($result)
            if ($result.status -eq "failed") {
                $overallExitCode = 1
            }
        }
    }
} catch {
    $fatalError = $_.Exception.Message
    $overallExitCode = 1
    Write-Host "ERROR: $fatalError" -ForegroundColor Red
} finally {
    try {
        Write-Reports
    } catch {
        $overallExitCode = 1
        $reportError = $_.Exception.Message
        $manifestPath = Join-Path $runDirectory 'manifest.json'
        if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
            $failedManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            $failedManifest.status = 'failed'
            $failedManifest | Add-Member -Force NoteProperty reportError $reportError
            Write-Utf8File $manifestPath ($failedManifest | ConvertTo-Json -Depth 30)
            $summaryPath = Join-Path $runDirectory 'summary.md'
            if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
                $summaryText = (Get-Content -LiteralPath $summaryPath -Raw).Replace('- Status: **passed**', '- Status: **failed**')
                Write-Utf8File $summaryPath ($summaryText + "`nReporting or compaction failed: $reportError`n")
            }
        }
        Write-Host "Reporting or compaction failed: $reportError" -ForegroundColor Red
    } finally {
        foreach ($name in $managedEnvironment) {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], "Process")
        }
        Set-Location $originalLocation
    }
}

Write-Host "`nResults: $runDirectory" -ForegroundColor Green
Write-Host "Summary: $(Join-Path $runDirectory 'summary.md')"
if ($overallExitCode -ne 0) {
    exit $overallExitCode
}
