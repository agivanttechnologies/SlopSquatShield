# slopsquatshield CLI — source overview

The `slopsquatshield` binary: manual scan, the safe-install wrapper, `init` / `doctor`, the
agent-hook entry points, `allow`, and the pre-commit check. It is a **thin adapter** over
`@slopsquatshield/core`: it reads files, spawns processes, prints, and sets an exit code — it owns no
detection rule.

> There is deliberately no `packages/cli/README.md`: `npm pack` copies the root README and LICENSE
> into the package at pack time (`scripts/copy-package-docs.mjs`) and deletes them afterwards, and
> `packages/cli/.gitignore` keeps those copies out of git. This file is the developer-facing one.

## Commands (wired in `index.ts`)

| Command | What it does | Code |
|---|---|---|
| `scan [path]` | Scan a project's manifests. `--json`, `--report-only`. | `commands/scan.ts` |
| `npm` / `pip` / `mvn <args>` | Verify, then forward to the real package manager. | `commands/install-wrapper.ts` |
| `init` | Write the launcher, shell wrapper, agent hooks, git hook, CI shims. | `commands/init.ts` |
| `doctor` | Report each surface's state with the exact fix. | `commands/doctor.ts` |
| `uninstall` | Remove everything `init` set up (`--dry-run` to preview, `--purge` for the cache). | `commands/uninstall.ts` |
| `allow <id>` | Add a package to `.slopsquatshield`. | `commands/allow.ts` |
| `precommit [files…]` | Advisory scan of staged manifests; only a BLOCK fails. | `commands/precommit.ts` |
| `hook <host>` | Agent-hook entry points: `claude-code`, `cursor`, `codex`, `antigravity`. | `hooks/` |

## Files in this folder

| File | Role |
|---|---|
| `index.ts` | Commander wiring. `enablePositionalOptions()` + `passThroughOptions()` on the wrappers, so `npm --version` reaches the real npm instead of printing ours. Also the **self-heal**: on any non-`hook` run it repairs a stale launcher (best-effort, never throws). `--version` is injected at build time from `package.json`. |
| `project-context.ts` | `loadProjectContext(dir)` — reads `.slopsquatshield` and the project config (`.slopsquatshieldrc` / the `package.json` key) through core. **Every surface loads both through here**, so none can drift (FR-5.2). |
| `discover-manifests.ts` | Finds manifests and lockfiles under a directory (skipping `node_modules`, `.git`, `dist`, …), or sorts an explicit file list (`classifyManifests`, used by pre-commit). |
| `extract-all.ts` | Runs core's per-file extractor across what discovery found; a manifest that won't parse becomes a located error and is skipped. Also de-duplicates names across files. |
| `manifest-io.ts` | `nodeManifestReader` — the real-filesystem `ManifestReader` the hook runner and install wrapper hand to core, so a bare `npm install` is checked against the project's manifest. Every I/O error is swallowed as "not there" (a hook must never crash on a filesystem oddity). |
| `build-lockfile-index.ts` | Reads the lockfiles discovery found into one index for core's lockfile fast path. |

## Subfolders

[`commands/`](commands/README.md) · [`format/`](format/README.md) · [`hooks/`](hooks/README.md) ·
[`install/`](install/README.md) · [`shell/`](shell/README.md) · tests in [`../test/`](../test/README.md)

## Build

`tsup` bundles **everything, core included, into one unminified `dist/index.js`** (`splitting: false`),
leaving only the native `better-sqlite3` external. That is required to publish at all (core is a
private workspace package) and it is the latency fix: an agent hook is a fresh process per tool call,
and one file starts in about 125 ms where hundreds of resolved `node_modules` files took seconds on a
slow filesystem. Build order matters — the root `build` script builds core first.

## Rules that apply here

- **Never touch real machine state from a test through an implicit default.** Home directory, cache
  path, shell profiles, WSL detection and the git hooks directory are all explicit, injectable
  parameters (`home`, `cachePath`, `detectWslHome`, …); the real resolver is only the default.
- **A bug in a hook must never block an agent or a commit.** Hook subcommands catch everything and
  fail open; `precommit` does too.
