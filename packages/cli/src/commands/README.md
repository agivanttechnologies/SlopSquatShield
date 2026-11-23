# commands

One file per CLI command. Each exports a plain `run…` function that takes its inputs (and, for
anything touching the machine, injectable paths) and returns data; `../index.ts` does the printing
and exit codes. That split is what makes them testable without spawning the binary.

| File | `run…` | Notes |
|---|---|---|
| `scan.ts` | `runScan(rootDir, { files?, cachePath? })` | Discovery → extraction → core's `scanDependencies`. Loads the allowlist and config via `project-context`. With `files` (the pre-commit path) it scans only those and never spawns Maven. Returns the report, including `manifestErrors`. |
| `install-wrapper.ts` | `runInstallWrapper(tool, args, options)` | Extracts installs from the command, checks them, then forwards via `cross-spawn`. A BLOCK returns 2 without ever spawning the real tool. **Fails open** with a stderr note when a registry is unreachable. Strips `SLOPSQUATSHIELD_SHIM_DIR` from `PATH` before forwarding, or a CI shim would find itself and recurse. Applies the project allowlist and config. |
| `init.ts` | `runInit(cwd, options)` | Idempotent. Writes the launcher, then whatever was asked for (`--shell`, `--claude-code`, `--cursor`, `--codex`, `--antigravity`, `--git-hook`, `--ci`). `--all` = shell wrapper + a hook for each agent host whose config directory it **finds**; `--git-hook` is never part of `--all` (it edits the repository). `--project` writes hook configs into the project instead of your user config. Refuses to run from an `npx`/`pnpm dlx` cache. |
| `doctor.ts` | `runDoctor(cwd, options)` | One check per surface, each with the exact fix command. Looks in every scope (user, project, WSL home). The **live run** executes each configured hook in a minimal environment (only `HOME` and a system `PATH`) — the check that would have caught the nvm exit-127 failure. Codex/Antigravity checks only appear when that host looks installed. |
| `uninstall.ts` | `runUninstall(cwd, options)` | The exact inverse of `init`: removes the shell-wrapper block from the bash/zsh/PowerShell profiles (both PowerShell 7 and Windows PowerShell 5.1 on Windows, including a block an older `init` left under `<home>\Documents` when Documents is redirected), our entry from each agent host's config (user level, and project level when run from a project), our block from this repo's pre-commit hook, and the launcher directory (which holds any CI shims). Touches only what `init` wrote — other content is kept byte for byte, a pre-commit hook someone chained after ours survives, a file that held only our block is deleted, and the project's `.slopsquatshield` / `.slopsquatshieldrc` are never deleted. `--dry-run` lists without changing anything; `--purge` also deletes the registry cache; a config that isn't valid JSON is never rewritten (reported, exit 1). Every path is injectable. |
| `allow.ts` | `runAllow(cwd, identifier)` | Appends to `.slopsquatshield` (idempotent) using core's `appendToAllowlist`. |
| `precommit.ts` | `runPrecommit(rootDir, files)`, `listStagedFiles(cwd)` | The advisory pre-commit scan. Only a BLOCK (2) fails; WARN (1) and unreachable (3) print and pass. Prints the override order. `--staged` lets it ask git for the staged files. |

## Exit codes

`0` clean · `1` suspicious · `2` hallucination · `3` registry unreachable — the same everywhere,
except `precommit`, which maps everything but `2` to `0`.

## Tests

`test/commands/`. Every `runInit`/`runDoctor` call passes `home`, `selfLocation`, `detectWslHome`
(and, for doctor, `runHookCommand`) explicitly so a test can never write to your real profile or
spawn `wsl.exe`.
