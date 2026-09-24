# Installed consumer fixture

`town-dungeon.json.gz` is a gzip-compressed JSON map of repository-relative paths
to base64 file bytes from the separately owned Town/Dungeon consumer. The adjacent
manifest records its revision and SHA-256 of every file and the archive. It includes
the consumer source, correctness tests, production content, package lockfile,
configs, package checker, README and license. It contains no engine source,
installed dependencies or prebuilt game. Consumer schemas and mechanics remain
owned by the original project; this is a pinned validation input.

After building the engine, `npm run test:installed` verifies and extracts this
snapshot into a fresh `.test-output/installed-content/consumer`, packs the current
engine, updates the copied consumer lockfile for that tarball, then runs `npm ci`,
consumer tests, strict root/nested builds and the package closure check. Logs and
`manifest.json` retain the engine revision/dirty state, package digest, source,
installed module and build identities. Set `NGNE_INSTALLED_CONTENT_DIR` to a new
directory for another run; existing consumer directories are deliberately rejected.

`node tests/installed-browser.mjs` copies and serves both installed builds and runs
the browser integration harness against each. It uses the same
`NGNE_INSTALLED_CONTENT_DIR`; `NGNE_INSTALLED_BROWSER_DIR` can select a fresh
browser output directory. The fixture must match the installation manifest, and
missing session/checkpoint/save controls fail validation. Preview and browser
process cleanup must pass before `orchestration.json` can report success.
CI runs this command using SwiftShader. These checks are software-WebGPU evidence. Physical device
recovery and manual controls/audio/visibility are separate acceptance gates.

To refresh, start from a clean consumer revision. Include all tracked `src/`,
`tests/` and `public/` files as well as the root/config/checker files named in the
manifest, so new gameplay modules and tests cannot be omitted. Encode them as
base64 JSON values, gzip that map, and regenerate the archive/file
SHA-256 digests and consumer revision together. Review changes against the owning
consumer. Never refresh expected identities to conceal an unexplained difference.

See the [final artifact evidence](../../docs/evidence/installed-content.md) and
the separate [transition measurements](../../benchmarks/evidence/content.md).
