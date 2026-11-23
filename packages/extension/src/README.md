# extension source

The advisory editor surface (FR-19). It reports; it never enforces, and it says so. It imports
`@slopsquatshield/core` **in-process** — there is no detection logic here, only wiring from core's
results to the editor.

The design rule: **everything that decides something is a pure module with no `vscode` import**, so
it can be unit-tested directly. Only `extension.ts` touches the VS Code API.

| File | Role | Needs `vscode`? |
|---|---|---|
| `extension.ts` | `activate()` — wires events, diagnostics, the status bar, the quick-fix provider and the commands to the pure modules. Returns a small test API. | yes |
| `manifest-scan.ts` | `scanManifest()` — core extracts, core scans, core judges; this attaches editor ranges and maps each result to a `Finding`. Never throws: a manifest that won't parse becomes one Information finding at the error position. | no |
| `findings.ts` | The `Finding` type — one diagnostic's worth of information. | no |
| `severity.ts` | BLOCK → Error, WARN → Warning, unreachable registry / unreadable manifest → Information (**never** an Error — fail-open applies in the editor too). Also `exitCodeFor`, the shared four-code scheme. | no |
| `locate.ts` | Finds where a dependency is declared in the document text. Core's extractors return names, not positions, so this does the searching: `package.json` sections (string/brace-aware), `requirements.txt` / `pyproject.toml` / `Pipfile` (PEP 503 name normalisation), `pom.xml` (by groupId **and** artifactId). Returns `undefined` rather than guessing. | no |
| `actions.ts` | `quickFixesFor(finding, text)` — Remove dependency (whole-line edit, plus the dangling-comma fix when the last JSON/TOML item goes), Add to `.slopsquatshield`, and Did-you-mean (only when the name-similarity signal fired *and* gave a suggestion; never for Maven). Returns plain text edits. | no |
| `status.ts` | `summarize(findings)` — the status-bar text and tooltip: the workspace's worst result in the four-code scheme, labelled "Advisory only". | no |
| `text.ts` | Position/range/edit types (the same shape as VS Code's) and line arithmetic. | no |

## Behaviour worth knowing

- **Scans on open and save, debounced per file** (`slopsquatshield.debounceMs`, default 500 ms), and
  once for the whole workspace at activation. It reads the *unsaved* editor text.
- **In-memory cache** (`MemoryCache`), not SQLite: a native module can't ship to every editor's
  Electron, so one universal `.vsix` (no native code) works in VS Code, Cursor, Windsurf, VSCodium and
  Antigravity. The cost is a cold cache each session.
- Reads the same `.slopsquatshield` and project config as the CLI (through core's parsers); a bad
  config falls back to defaults and is logged once to the "SlopSquatShield" output channel.
- Package **names** go to the public registry services; nothing else leaves the machine.

## Build

`esbuild.mjs` bundles the extension and core into one unminified CommonJS file. Only `vscode` (given by
the host) and the native `better-sqlite3` are external — and the latter is never loaded.

Tests: [`../test/`](../test/README.md). Real-editor test: [`../test-integration/`](../test-integration/README.md).
