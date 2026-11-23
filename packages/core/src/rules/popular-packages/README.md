# rules/popular-packages

The reference lists the `name-similarity` signal compares a name against: if an unknown package is
within a couple of edits of something on a list (say, one swapped letter away from
`requests`), that's a slopsquat-style warning sign.

| File | Export | Entries |
|---|---|---|
| `npm.ts` | `POPULAR_NPM_PACKAGES` | about 80 |
| `pypi.ts` | `POPULAR_PYPI_PACKAGES` | about 80 |
| `maven.ts` | `POPULAR_MAVEN_COORDINATES` (`groupId:artifactId`) | about 50 |

## Things to know

- These are **curated by hand**, a *reference* list of well-known names — not the registry and not
  auto-refreshed from a live source. They will need an occasional refresh as popularity shifts.
- Short names are more likely to be within two edits of *something*, so a very short package name can
  trip the similarity signal. That is a WARN on its own, not a block; it only escalates alongside
  another WARN signal.
- Adding a name is a one-line change; keep each list in the same style (one name per line).
