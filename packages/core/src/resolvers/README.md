# resolvers

The **lockfile index** (FR-3.4). A package pinned in a lockfile was resolved by the real package
manager at lock time — but a lockfile can be edited by hand or by an AI agent, so a pin is evidence
of *where a package came from*, not proof that it is safe. A pinned package is therefore **checked
like any other** (age, downloads, look-alike name, repository link); the pin only softens one
outcome, "not on the public registry", which becomes a WARN (or CLEAN for a declared private scope)
instead of a BLOCK. See `scan/lockfile-pin.ts`.

| File | Does |
|---|---|
| `types.ts` | `LockfilePin` (one name pinned to one version), `buildLockfileIndex(pins)`, and `resolveViaLockfile(identifier, index)` — the lookup `resolveVerdict()` calls. |
| `lockfile/` | The parsers that produce pins — see [`lockfile/`](lockfile/README.md). |

The CLI builds one combined index per scan (`cli/src/build-lockfile-index.ts`) and passes it in; the
editor extension and the agent hooks don't use it (they check names, not whole projects).

## Tests

`test/resolvers/`.
