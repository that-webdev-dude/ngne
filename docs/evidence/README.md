# Historical evidence

This directory preserves recorded acceptance results and artifact provenance. It is
not an API specification or a statement that the current checkout passes those
checks. Each result is scoped to the revisions, package hashes, consumer snapshot,
browser/device and environment recorded in its report and machine manifest.

| Record                                                 | Contents                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [Installed content acceptance](installed-content.md)   | Dated result matrix, manual acceptance, artifact equivalence and measured limitations                         |
| [Machine manifest](installed-content.json)             | Recorded timestamp, revision/environment details, identities and browser results                              |
| [Raw local archive](installed-content-raw.json.gz)     | Original local JSON and logs                                                                                  |
| [Hosted archive](installed-content-hosted.zip)         | Hosted logs, manifests, package and builds                                                                    |
| [Recorded package](installed-content-package.tgz)      | Package used by the recorded acceptance                                                                       |
| [Installed engine verification](installed-engine.json) | Two consecutive consumer-independent Windows/SwiftShader runs; selected records and explicit retention limits |

The [contract index](../contracts/NGNE.md) leads to current behavior specifications;
the [guide](../guide.md) owns usage. Preserve recorded manifests, archives, packages
and hashes when editing explanatory documentation. New executions produce separate
evidence; they do not retroactively refresh these results.

For reproduction, use the [installed fixture instructions](../../tests/fixtures/README.md),
[browser harness instructions](../../README.md#verify) and
[content measurement procedure](../../benchmarks/content/README.md). Consult the
recorded report for its exact root/nested setup, device distinctions and limitations.
