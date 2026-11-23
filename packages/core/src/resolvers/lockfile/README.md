# resolvers/lockfile

One parser per lockfile format, each returning `LockfilePin[]` (name + exact version).

| File | Format |
|---|---|
| `npm.ts` | `package-lock.json` — both shapes: v2/v3's flat `packages` map (keyed by `node_modules/…` paths) and v1's nested `dependencies` tree. |
| `poetry.ts` | `poetry.lock` — each `[[package]]` table is one exact resolved version. |
| `pipfile.ts` | `Pipfile.lock` — both the `default` and `develop` sections. |
| `maven.ts` | Maven has no lockfile, so this parses the output of `mvn dependency:tree` (`parseMavenDependencyTree`) and can run it (`getMavenDependencyTreePins`). Needs the user's own JDK + Maven; **fails open to `[]`** when they're missing, and ignores the `[WARNING] The POM for … is missing` lines. |
| `index.ts` | Re-exports the four. |

Parsers are pure and take file *text*; reading files is the caller's job. The Maven runner is the
one exception that spawns a process — it's skipped for pre-commit file-list scans so a commit never
waits on Maven.

## Tests

`test/resolvers/lockfile/`.
