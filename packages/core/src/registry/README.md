# registry

Clients that ask the public registries about a package and return **facts** — whether it exists,
when it was first published, whether it links to a repository, and (for npm/PyPI) weekly downloads.
They make no judgement; `rules/` does that.

| File | Source | Used for |
|---|---|---|
| `deps-dev.ts` | [deps.dev](https://deps.dev) | **Primary** for npm and PyPI: existence, first-publish date, repository link. It has no download counts at all. |
| `npm.ts` | the public npm registry (via `npm-registry-fetch`, which honours the proxy environment variables; it does not read `.npmrc`, so no private registry or credentials are used) + `api.npmjs.org` for downloads | npm fallback when deps.dev is unreachable, and the **only** source of npm's weekly downloads. |
| `pypi.ts` | PyPI's JSON API + [pypistats.org](https://pypistats.org) for downloads | The same two roles for PyPI. |
| `maven-central.ts` | Maven Central | The **sole** source for Maven (there is no deps.dev fallback and no download count — the "Maven popularity gap"). |
| `proxy-fetch.ts` | — | `proxyFetch`: wraps the global `fetch` so `HTTPS_PROXY` / `HTTP_PROXY` are honoured, which Node's built-in fetch doesn't do. |
| `npm-registry-fetch.d.ts` | — | Type declarations for the untyped `npm-registry-fetch`. |

## Where package names go

A package *name* is sent to: `api.deps.dev`, `registry.npmjs.org` and `api.npmjs.org` (npm), `pypi.org` and `pypistats.org` (PyPI), and Maven Central. Nothing else is sent — no file contents, no paths, no telemetry.

## The one rule that matters

**A 404 means "does not exist"; anything else that goes wrong means "unreachable" — and the two are
never confused.** A 404 returns `{ exists: false }` (a real finding). A network error, a 5xx or a
malformed body **throws**, so the caller can apply the fail-open rule (NFR-3.1): an unreachable
registry is reported as exit code 3, never silently turned into "this package doesn't exist". A
failure fetching *only* the download count is soft-omitted and doesn't abort the lookup.

## Order of sources (decided in `scan/resolve-verdict.ts`)

deps.dev first; the native client only when deps.dev itself is unreachable, plus always for npm/PyPI
download counts. Every client takes an injectable `fetch`, so tests never touch the network.

## Tests

`test/registry/` with `msw` handlers; fixtures under `test/fixtures/`.
