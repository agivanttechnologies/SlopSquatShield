# cache

Remembers registry answers so a repeat lookup needs no network (FR-7). A cache is an
optimisation, never a failure point.

| File | What it is |
|---|---|
| `types.ts` | `FactCache` — the three-method interface the engine depends on (`get` / `set` / `close`) — plus the fact types and `DEFAULT_CACHE_TTLS`. |
| `store.ts` | `RegistryCache`: SQLite, in the OS cache directory (`defaultCacheDbPath()`), never inside the scanned repo. Used by the CLI and the agent hooks. |
| `memory.ts` | `MemoryCache`: same TTLs, held in memory. Used by the VS Code extension, where a native module can't be shipped to every editor. |

## Behaviour

- **Two fact types, expiring independently:** `existence` (default 14 days — a published package
  rarely un-publishes) and `popularity` (default 48 hours — download counts drift daily).
- **Corruption is survivable.** If the SQLite file is damaged, `RegistryCache` moves it aside
  (`…sqlite3.corrupt-<timestamp>`), removes its stale WAL/SHM sidecars, rebuilds an empty database
  and warns once. A damaged row, or a read/write that fails at runtime, degrades to a miss / no-op
  instead of throwing. A failure that is *not* corruption (a directory where the file should be)
  still throws.
- **`better-sqlite3` loads lazily**, inside the `RegistryCache` constructor, so importing core never
  pulls in the native module. (It picks `createRequire(import.meta.url)` under ESM and the real
  `require` in a CJS bundle; don't test `typeof require` first — esbuild's ESM output injects a
  throwing shim.)
- `MemoryCache` hands out copies, so a caller mutating a result can't corrupt the cache.

## Tests

`test/cache/` — round-trips, per-type TTL expiry, corruption recovery, and a test that bundles core
as both ESM and CJS to prove the native module is only needed when a `RegistryCache` is built.
