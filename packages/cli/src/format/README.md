# format

Turns a scan report (or an `init` result) into text. Pure functions; no I/O.

| File | Output |
|---|---|
| `style.ts` | `createStyle(stream)` — the one place that decides how human output looks: colour only for a terminal (honours `NO_COLOR`; `FORCE_COLOR` on, but `FORCE_COLOR=0`/`false` off; `TERM=dumb` off), the wrap width (terminal width, else 80), and the symbols (`✗ ! ? ✓ – ·`, ASCII where Unicode isn't safe: `TERM=dumb`, the legacy Windows console). `creditLines(style)` ends terminal output with the credit; piped output, hooks, the wrapper and JSON never get it. `plainStyle()` for tests. |
| `paths.ts` | `displayPath(path, { cwd, home })` — relative inside the current directory, `~/…` under home, absolute otherwise. `home` is always passed in, never read from the OS here. |
| `scan.ts` | `formatScanReport(report, { reportOnly?, credit?, next?, style?, paths? })` — the human scan report (FR-8.1): a list of findings — BLOCK, then WARN, then packages that couldn't be verified (with a short cause from core's `describeUnreachable`) — then any manifests that couldn't be read as `file:line:column`, a one-line summary (`9 packages checked: 2 blocked, 1 warning.` / `✓ 9 packages checked: no findings.`) and what to do next. Pre-commit passes `next: false` (it prints its own numbered steps). With `reportOnly` it adds a line saying a normal scan would have exited with the real code. |
| `finding.ts` | `renderFindings(rows, style)` — the finding list every surface shares: `✗ name  npm · package.json [dependencies]`, the reason wrapped and indented beneath. Names are never truncated; when the heading wouldn't fit the terminal, the ecosystem and source move to their own line. Also `wrap()` and `count()`. |
| `init.ts` | `formatInitResult(result, { style?, paths? })` — what `init` did, in plain words: what was set up, what was left alone and why (a git hook in another language, a config file that isn't valid JSON, a run from an npx cache), and the next steps for what was actually set up (a new terminal only if a shell wrapper was written, an agent restart only if a hook was). Returns `{ text, ok }`; `ok` is false when something asked for couldn't be configured, which makes the exit code 1. `init --json` prints the raw result instead. |
| `doctor.ts` | `formatDoctorReport(report, { style?, paths? })` — `doctor`'s checks grouped under Setup / Agent hooks / Toolchain with init's marks (`✓` ok, `!` outdated, `✗` missing or not working), a `fix:` line under each problem, and `N problems: run the fix lines above.` or `✓ All good.` |
| `uninstall.ts` | `formatUninstallResult(result, { paths, style? })` — what `uninstall` removed (or, in a dry run, would), what it couldn't remove safely, and what it deliberately left alone (your project's `.slopsquatshield`, the cache). |
| `install.ts` | `formatInstallReport(command, check, style)` — what the install wrapper writes to stderr: for a BLOCK, `blocked \`npm install x\`; nothing was installed.`, the findings (each says `named in the command` or `declared in package.json`) and the next step; for a WARN, `installing anyway`; then anything not verified (with a short cause). Empty for a clean install. Never suggests a way around the wrapper — an agent in a wrapped shell reads it too. |
| `json.ts` | `formatScanJson(report, { reportOnly? })` — the machine-readable form (FR-8.2): `scannedCount`, the real `exitCode`, `reportOnly`, `findings`, `unreachable`, `manifestErrors`. Same facts as the table. |

`--report-only` changes the **process** exit code to 0 (done in `../index.ts`), not these outputs'
content: the JSON still reports the exit code a normal scan would have produced.

Every human-readable output ends with the credit on a terminal (`creditLines`), never when piped.

Tests: `test/format/doctor.test.ts`, `test/format/install.test.ts`, `test/format/style.test.ts`, `test/format/paths.test.ts`, `test/format/scan.test.ts`, `test/format/init.test.ts`, `test/commands/scan.test.ts` and `test/commands/config-wiring.test.ts`.
