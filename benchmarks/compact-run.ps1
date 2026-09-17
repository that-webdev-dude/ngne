function Compress-BenchmarkRun {
    param([string]$RunDirectory, [string]$ResultsScript, [string]$Node)
    $root = [System.IO.Path]::GetFullPath($RunDirectory).TrimEnd([char[]]"\/")
    $prefix = $root + [System.IO.Path]::DirectorySeparatorChar
    $manifestPath = Join-Path $root 'manifest.json'
    $keep = @('summary.md', 'analysis.json', 'manifest.json')
    function Assert-PlainPath([string]$Path) {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            throw "Compaction refuses links or junctions: $Path"
        }
        return $item
    }
    # Check ancestors as well as descendants before reading or deleting artifacts.
    $ancestor = $root
    while ($ancestor) {
        $null = Assert-PlainPath $ancestor
        $ancestor = [System.IO.Path]::GetDirectoryName($ancestor)
    }
    $files = [System.Collections.Generic.List[string]]::new()
    $directories = [System.Collections.Generic.List[string]]::new()
    function Read-Tree([string]$Directory) {
        foreach ($entry in Get-ChildItem -LiteralPath $Directory -Force) {
            $path = [System.IO.Path]::GetFullPath($entry.FullName)
            if (-not $path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Compaction target escaped run directory' }
            $item = Assert-PlainPath $path
            if ($item.PSIsContainer) { Read-Tree $path; $directories.Add($path) }
            elseif ($Directory -ne $root -or $item.Name -notin $keep) { $files.Add($path) }
        }
    }
    Read-Tree $root
    foreach ($name in $keep) {
        $item = Assert-PlainPath (Join-Path $root $name)
        if ($item.PSIsContainer -or $item.Length -eq 0) { throw "Missing retained file: $name" }
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.status -ne 'passed' -or $manifest.fatalError -or @($manifest.stages | Where-Object status -ne 'passed').Count) { throw 'Failed or incomplete run: diagnostics retained' }
    if ([System.IO.Path]::GetFullPath($manifest.outputDirectory).TrimEnd([char[]]"\/") -ne $root) { throw 'Run directory does not match its manifest' }
    & $Node $ResultsScript validate $root
    if ($LASTEXITCODE -ne 0) { throw 'Analysis validation failed; diagnostics retained' }
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $manifest | Add-Member -Force NoteProperty retention ([pscustomobject]@{
        mode = 'compacting'; removedArtifacts = @(); rawEvidenceAvailable = $true
    })
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 30), $utf8)
    $removed = [System.Collections.Generic.List[string]]::new()
    try {
        foreach ($path in $files) {
            $null = Assert-PlainPath $root
            $parent = [IO.Path]::GetDirectoryName($path)
            while ($parent -and $parent -ne $root) { $null = Assert-PlainPath $parent; $parent = [IO.Path]::GetDirectoryName($parent) }
            $null = Assert-PlainPath $path
            Remove-Item -LiteralPath $path -Force -ErrorAction Stop
            $removed.Add($path.Substring($prefix.Length).Replace('\', '/'))
        }
        foreach ($path in $directories) {
            $null = Assert-PlainPath $path
            # Non-recursive removal cannot traverse newly introduced descendants.
            [IO.Directory]::Delete($path, $false)
        }
        $manifest.retention.mode = 'compact'
        $manifest.retention.rawEvidenceAvailable = $false
        $manifest.retention.removedArtifacts = $removed.ToArray()
        [IO.File]::AppendAllText((Join-Path $root 'summary.md'), "`nOutput: compact; raw artifacts removed. Comparisons use analysis.json.`n", $utf8)
    } catch {
        $manifest.retention.mode = 'failed'
        $manifest.retention.rawEvidenceAvailable = $removed.Count -eq 0
        $manifest.retention | Add-Member NoteProperty error $_.Exception.Message
        $manifest.retention.removedArtifacts = $removed.ToArray()
        throw
    } finally {
        [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 30), $utf8)
    }
}
