# core tests

Vitest, run from the repo root (`npm test`, or `npm test -- packages/core`). The folders mirror
`src/`.

| Folder | Covers |
|---|---|
| `allowlist/`, `cache/`, `config/`, `extractors/`, `hooks/`, `registry/`, `resolvers/`, `rules/`, `scan/` | The matching `src/` folder. |
| `fixtures/` | Sample manifests and install commands, one set per requirement (`npm/`, `pypi/`, `maven/`, `markdown/`, `install-commands/`). |
| `msw/` | The shared [MSW](https://mswjs.io) server that mocks registry HTTP. |

## Rules for tests here

- **No real network.** Registry calls are mocked with MSW, and `onUnhandledRequest: 'error'` makes an
  unexpected call fail the test — which is also how "this must short-circuit before any lookup"
  (allowlist, non-install command) is asserted.
- **Never reach real machine state through an implicit default.** Anything that touches the home
  directory, the cache path or similar takes an explicit, injectable argument; tests pass a temp
  directory. (`os.homedir()` ignores a `HOME` override on Windows, and an early test once wrote into a
  real shell profile because of it.)
- Two tests build real bundles with esbuild (`cache/lazy-native-load.test.ts`) to prove the native
  SQLite module is only needed when a `RegistryCache` is constructed. If you change how core loads
  `better-sqlite3`, run them — the unit tests alone can't see a bundling failure.
