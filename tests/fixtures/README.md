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

CI then serves both builds and runs the browser integration harness against each
using SwiftShader. These checks are software-WebGPU evidence. Physical device
recovery and manual controls/audio/visibility are separate acceptance gates.

To refresh, start from a clean consumer revision. Encode the files named in the
manifest as base64 JSON values, gzip that map, and regenerate the archive/file
SHA-256 digests and consumer revision together. Review changes against the owning
consumer. Never refresh expected identities to conceal an unexplained difference.

See the [final artifact evidence](../../docs/evidence/installed-content.md) and
the separate [transition measurements](../../benchmarks/evidence/content.md).
