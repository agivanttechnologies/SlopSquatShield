# scripts

End-to-end checks and release helpers. The unit tests can't see build and packaging problems — a
loader that worked under Vitest once broke every hook in the bundled CLI — so these exercise the
**built** binary and the **packed** package. They use the real registries, so they need a network.
Each runs in a throwaway `HOME` and directory; none touches your real configuration.

| Script | What it proves | How to run |
|---|---|---|
| `ci-launcher-e2e.sh` | The launcher, every hook adapter (Claude Code, Codex, Antigravity), the stale-launcher fail-open, self-heal, `init --all` host detection and the CI shims all work from a minimal, hook-style environment (`env -i`, system `PATH`, no Node on it). | `CLI="node packages/cli/dist/index.js" bash scripts/ci-launcher-e2e.sh` (after `npm run build`). In CI, with the CLI linked, just `bash scripts/ci-launcher-e2e.sh`. |
| `smoke-test-packed.sh <tgz>` | The plan's release smoke test. The **packed** tarball installs from npm into a clean prefix; `--version` matches the package; `scan` BLOCKs one hallucinated package per ecosystem (npm, PyPI, Maven); the shell wrapper, the Claude Code hook (minimal environment) and the git pre-commit hook all BLOCK; `--no-verify` overrides; `doctor` sees the launcher. | `(cd packages/cli && npm pack --pack-destination /tmp/pack)` then `bash scripts/smoke-test-packed.sh /tmp/pack/*slopsquatshield-*.tgz` |
| `precommit-framework-e2e.sh <tgz>` | The real [pre-commit](https://pre-commit.com) framework installs this repo's `.pre-commit-hooks.yaml` (`language: node`); a hallucinated manifest fails the commit, `--no-verify` bypasses, a clean manifest passes, a commit with no manifests doesn't run the hook. A locally packed tarball stands in for the npm package, which doesn't exist until a release. | Needs `pre-commit` on `PATH` (`pip install pre-commit`). Same pack step as above. |
| `measure-hook-latency.mjs` | Hook latency (process start → stdout) for each host, against the 300 ms warm budget. Prints median / p95 per host and scenario; exits 1 over budget. Measure from a native filesystem — the repo on a slow mount (e.g. WSL's `/mnt/c`) inflates it. | `node scripts/measure-hook-latency.mjs [--runs 30] [--cli path/to/index.js]` |
| `copy-package-docs.mjs` | Copies the root README and LICENSE into a package directory for `npm pack` and removes them afterwards, so there's no second committed copy. Wired as the CLI's `prepack` / `postpack`; not for manual use. | (run by npm) |

CI runs the first three — see [`../.github/workflows/`](../.github/workflows/README.md).
