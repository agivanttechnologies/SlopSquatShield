# workflows

## `ci.yml` — runs on pushes to `main` and on every pull request

| Job | Runs on | What it checks |
|---|---|---|
| `build-and-test` | ubuntu, macOS, Windows × Node 22 and 24 | `npm ci`, build, and the whole Vitest suite. |
| `launcher-e2e` | ubuntu, macOS × Node 22 and 24 | `scripts/ci-launcher-e2e.sh`: the launcher and every hook adapter from a minimal environment. |
| `vscode-extension` | ubuntu | Packages the `.vsix` (uploaded as an artifact) and runs the extension inside a real VS Code under `xvfb`. |
| `packed-smoke` | ubuntu, macOS | `scripts/smoke-test-packed.sh`: install the **packed** tarball and BLOCK a hallucinated package in each ecosystem. Also lists what would be published. |
| `precommit-framework` | ubuntu | `scripts/precommit-framework-e2e.sh`: the real pre-commit framework against this repo's hook definition. |

A push to any other branch does **not** run CI — open a pull request.

## `dco.yml`: runs on every pull request

One job, `dco`: `scripts/check-dco.sh` fails if any non-merge commit lacks a `Signed-off-by:` line
with its author's email (Developer Certificate of Origin, see `DCO.txt` and CONTRIBUTING.md). GitHub
bot commits, such as Changesets' "Version Packages" pull request, are skipped. Make it a required
check on `main`.

## `release.yml` — manual only, from `main`

Runs only when started from the Actions tab (`workflow_dispatch`), never on a push, and only from
`main`. Uses [Changesets](https://github.com/changesets/changesets): the first run opens a
"Version Packages" pull request; running it again after that merges builds, tests and publishes
`slopsquatshield` to npm with provenance, then publishes the same build again as
`@agivanttechnologies/slopsquatshield`. It needs either the `NPM_TOKEN` secret (first publish) or npm
trusted publishing configured for this workflow on both package names. It creates no GitHub
release or tag: those are made by hand with a `v` tag. The VS Code extension is published by hand.

## Status

All `ci.yml` jobs have run green on real runners (Linux, macOS, Windows). The Windows leg doesn't
run the launcher or smoke scripts, which are POSIX shell. `release.yml` has never run: it needs a
merge to `main` and the npm credentials first.
