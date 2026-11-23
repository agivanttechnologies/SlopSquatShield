# cli tests

Vitest, run from the repo root (`npm test`, or `npm test -- packages/cli`). The folders mirror
`src/`.

| Folder | Covers |
|---|---|
| `commands/` | `scan`, the install wrapper, `init`, `doctor`, `allow`, `precommit`, and `config-wiring.test.ts` (the project config and allowlist being honoured by every surface). |
| `hooks/` | The four host formatters and config writers, stdin parsing, the hook runner, the lazy cache, the git hook, and `warn-across-hosts.test.ts` (one WARN fixture through every host). |
| `install/` | The launcher, including real `sh` runs of the generated script. |
| `shell/` | The shell snippets, the CI shims, and (mocked) WSL detection. |
| `fixtures/scan-project/` | A small project with one BLOCK and three WARN cases for the scan tests. |
| `msw/` | The shared MSW server that mocks registry HTTP. |

## Rules for tests here

- **No real network.** Registry calls are mocked with MSW and unhandled requests fail the test.
- **Never reach real machine state through an implicit default.** Pass `home`, `cachePath`,
  `selfLocation`, `detectWslHome` and (for `doctor`) `runHookCommand` explicitly, with temp
  directories. This is the rule an early test broke by writing into a real shell profile.
- Git-hook and `--staged` tests run real `git` in a temporary repository — never in this one.
- Unit tests can't see a *build* problem: a loader that worked under Vitest once broke every hook in
  the bundled CLI. Changes to build output also need `scripts/ci-launcher-e2e.sh` and
  `scripts/smoke-test-packed.sh` (see `scripts/README.md`).
