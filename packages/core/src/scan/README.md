# scan

Orchestration: ties extraction, the allowlist, lockfiles, the cache, the registries and the rule
engine into one call per package. Every surface that checks packages goes through here.

| File | What it does |
|---|---|
| `resolve-verdict.ts` | `resolveVerdict(identifier, ecosystem, options)` — one package → `{ kind: 'verdict' }` or `{ kind: 'unreachable' }`. The order is **allowlist → cache → registry → rules → lockfile pin**; only the allowlist skips the checks. A lockfile pin no longer skips them: it softens "not on the public registry" from BLOCK to WARN (`lockfile-pin.ts`). A cached "does not exist" is a complete answer, and a missing downloads figure costs one downloads request, not a full re-fetch. |
| `lockfile-pin.ts` | `applyLockfilePin(verdict, pinned, privateScope?)` — what a lockfile pin changes about a verdict: a pinned name missing from the public registry is a WARN (CLEAN if it matches a declared private scope); everything else is unchanged. |
| `check-install-command.ts` | `checkInstallCommand(command, options)` — the one check the agent hooks and the install wrapper share. Verifies the packages a command **names** and, for a manifest-driven install (`npm install`, `npm ci`, `pip install -r f`, `mvn test`, …), the packages the project's manifest lists. Fails open and says so (`notVerified`, `unreachable`); a time budget (default 10 s) bounds a cold-cache check. Only parses a lockfile when something came back as not-found. |
| `manifest-install.ts` | `collectManifestInstall(install, reader)` — which dependencies a manifest-driven install will fetch, reading **exactly what the package manager reads** (nearest `package.json` upward to home + its declared workspaces; `-r` files and their includes; `pyproject.toml`/`Pipfile`; a POM and its `<modules>`) and never walking a tree. File access is an injected `ManifestReader`, so core touches no filesystem. Caps: 100 files, 5 MB each. |
| `local-packages.ts` | `excludeLocalPackages(deps, localNames)` and `packageJsonName(text)` — drop workspace members and `file:`/`link:`/`workspace:`/git/URL dependencies, which are not on the registry and would only produce a false "does not exist". |
| `scan-dependencies.ts` | `scanDependencies(targets, options)` — many packages, with bounded concurrency (default 8). Returns `{ verdicts, unreachable, exitCode }`. |
| `exit-codes.ts` | `EXIT_CODES` — the one scheme every surface translates to: `0` clean, `1` suspicious, `2` hallucination, `3` registry unreachable. |
| `extract-manifest.ts` | `extractDependenciesFromManifest(path, text)` — the single "which extractor for which file" dispatcher, shared by the CLI scan and the editor extension. Also `assertWellFormedPom` and `isSupportedManifest`. |
| `manifest-error.ts` | `ManifestParseError` — `file`, `line`, `column`, `reason`; its message is `file:line:column: reason`. |
| `json-error.ts` | `locateJsonError(text)` — recovers an exact error offset for invalid JSON (Node's own messages often omit one). It only *locates* an error `JSON.parse` already found. |
| `parse-json.ts` | `parseJsonLocated(path, text)` — `JSON.parse` that throws a located `ManifestParseError` instead of a raw `SyntaxError`. |

## Exit-code precedence

BLOCK (2) beats WARN (1) beats "some registry was unreachable" (3) beats clean (0). An unreachable
registry is **never** itself a finding: it is reported as such, and it never blocks (NFR-3.1).

## Malformed manifests (NFR-3.3)

A manifest that can't be parsed throws `ManifestParseError` with a position — from a strict JSON
scanner for `package.json`, from smol-toml's own line/column for TOML, and from an XML validator
for POMs (fast-xml-parser alone silently misreads a broken POM). Callers report it and carry on with
the other files; none of it ever surfaces as a stack trace.

## Tests

`test/scan/`.
