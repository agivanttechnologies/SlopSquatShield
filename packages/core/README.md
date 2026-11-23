# @slopsquatshield/core

The detection engine. **Every other surface — the CLI, the shell wrapper, the agent hooks, the
pre-commit hook, the VS Code extension — imports this package; none of them reimplements any of
it.** If you are about to write a parsing rule, a registry call or a verdict rule anywhere else,
it belongs here instead.

This package is **private** and is never published on its own: the CLI and the extension bundle it
at build time.

## How a package becomes a verdict

```
manifest or command text
  → extractors/    which dependencies does this declare?          (names + ecosystem)
  → scan/          for each one: resolveVerdict()
       allowlist/    allowlisted?  → CLEAN, no network
       resolvers/    pinned in a lockfile? → CLEAN, no network
       cache/        seen recently? → reuse the facts
       registry/     otherwise ask deps.dev / npm / PyPI / Maven Central
       rules/        evaluatePackage(facts) → CLEAN | WARN | BLOCK, with a plain-English reason
  → ScanResult      verdicts + unreachable registries + the shared exit code
```

## Folders

| Folder | What it does |
|---|---|
| [`src/extractors/`](src/extractors/README.md) | Reads dependencies out of manifests, install commands and Markdown. |
| [`src/registry/`](src/registry/README.md) | Clients for deps.dev, npm, PyPI and Maven Central. |
| [`src/resolvers/`](src/resolvers/README.md) | Lockfile parsing, so a pinned package needs no network. |
| [`src/cache/`](src/cache/README.md) | The registry-fact cache (SQLite, or in-memory for the editor). |
| [`src/rules/`](src/rules/README.md) | The rule engine: signals, thresholds, BLOCK/WARN/CLEAN. |
| [`src/allowlist/`](src/allowlist/README.md) | The `.slopsquatshield` file. |
| [`src/config/`](src/config/README.md) | The `.slopsquatshieldrc` project config. |
| [`src/scan/`](src/scan/README.md) | Orchestration, the manifest dispatcher, parse errors, exit codes. |
| [`src/hooks/`](src/hooks/README.md) | The host-neutral agent-hook decision. |
| [`test/`](test/README.md) | The Vitest suite and its fixtures. |

`src/index.ts` is the public API: everything another package may use is exported from there.

## Invariants (do not break)

- **Fail open on infrastructure, closed only on confirmed findings.** An unreachable registry, a
  corrupt cache or a malformed config is never itself a finding.
- **Every verdict carries a plain-English reason.** Never a bare score.
- **One exit-code scheme:** `0` clean · `1` suspicious (WARN) · `2` hallucination (BLOCK) ·
  `3` registry unreachable.
- **No telemetry.** The only network traffic is package names sent to the public registries.

## Build and test

```bash
npm run build -w @slopsquatshield/core   # tsup → dist/ (ESM + types); the CLI and extension bundle this
npm test -- packages/core               # Vitest, registry HTTP mocked with msw
```

`better-sqlite3` is a native module and is loaded lazily, only when a `RegistryCache` is actually
built, so a bundle that never builds one (the extension) loads without it.
