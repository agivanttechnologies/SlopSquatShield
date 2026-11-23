# extension tests

Vitest, run from the repo root (`npm test`, or `npm test -- packages/extension`).

| File | Covers |
|---|---|
| `locate.test.ts`, `actions.test.ts`, `severity-status.test.ts` | The pure modules directly — the bulk of the logic, no editor needed. |
| `manifest-scan.test.ts` | `scanManifest` against mocked registries: severities, allowlist, config, parse errors. |
| `extension.test.ts` | The **real** `activate()` path against a fake editor: diagnostics, debounce coalescing, the disabled setting, file deletion, the quick-fix provider, the allowlist command, project config. |
| `bundle.test.ts` | Builds the extension bundle and loads it in plain Node with a stub `vscode` and no `node_modules` — proof it carries no native module. |
| `fake-vscode.ts` | A small in-memory stand-in for the `vscode` module, aliased in as `vscode` by the root `vitest.config.ts`. It implements only what `extension.ts` uses. |
| `registry-mocks.ts` | The MSW server and registry helpers (`mockMissingNpm`, `mockHealthyNpm`, `mockDownNpm`, …). |

## What these tests are not

They exercise a *model* of the editor API, not an editor. They prove the wiring, not that it works in
a real VS Code, Cursor, Windsurf, VSCodium or Antigravity. That is what
[`../test-integration/`](../test-integration/README.md) is for — and it has not yet been run (see
there).

No real network: registry calls are mocked, and an unmocked request fails the test.
