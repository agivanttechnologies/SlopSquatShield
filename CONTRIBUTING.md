# Contributing to SlopSquatShield

Thanks for helping. SlopSquatShield sits in the install path and in an AI agent's tool-call path,
so a few rules matter more here than in most projects.

## Set up

Requires Node.js 22 or newer.

```bash
git clone https://github.com/agivanttechnologies/SlopSquatShield
cd SlopSquatShield
npm ci --ignore-scripts
npm rebuild @biomejs/biome esbuild --foreground-scripts   # the install-script allowlist skips these
npm run build        # builds core first, then the CLI and the VS Code extension
npm test             # Vitest, all packages
npm run lint         # Biome
```

To try the CLI from your clone: `npm link --workspace packages/cli`, then `slopsquatshield init --all`.

```
packages/
  core/             the detection engine: extraction, registries, cache, rules, allowlist, config
  cli/              the `slopsquatshield` binary: scan, wrapper, init/doctor, hooks, pre-commit
  extension/        the advisory editor surface
scripts/            end-to-end checks (launcher e2e, packed-package smoke test, hook latency)
.pre-commit-hooks.yaml   the pre-commit framework hook definition
```

## The rules that matter

1. **One engine, in `packages/core`.** Parsing manifests, resolving registries and the rule engine
   live only there. The CLI, shell wrapper, agent hooks, pre-commit hook and VS Code extension
   import it and never reimplement it. A rule written in an adapter belongs in core.
2. **Fail open on infrastructure.** An unreachable registry, a corrupt cache or a malformed config
   is never a finding and never silently blocks anyone. It is reported (exit code 3, a warning, a
   diagnostic) and the run goes on. Only confirmed findings fail closed.
3. **No telemetry.** Nothing leaves the machine except package names sent to the public registries.
4. **Tests never touch real machine state or the network.** Registry HTTP is mocked with `msw`.
   Anything outside a test's own temp dir (home directory, cache path, shell profiles, WSL
   detection, the git hooks directory) is an explicit, injectable parameter, with the real resolver
   only as the default, and every test passes it. `os.homedir()` ignores a `HOME` override on
   Windows, and an early test wrote into a real shell profile because of it. See `home` on
   `runInit`/`runDoctor` and `cachePath` on `RegistryCache`.

Also:

- Every BLOCK or WARN names its signal(s) in plain English; never a bare score.
- No obfuscated or minified shell, shim or hook-adapter code; it has to be auditable.
- One exit-code scheme everywhere: `0` clean, `1` suspicious, `2` hallucination, `3` registry
  unreachable. Surfaces translate to it.
- The VS Code extension and the pre-commit hook are advisory and are never described as enforcement.
- Don't claim what you haven't seen. Behaviour built from a host's documentation but not observed
  in the real application is described as such, in the code, the CHANGELOG and the README.

## Before you open a pull request

- `npm test`, `npm run lint`, and `npx tsc --noEmit -p packages/<each package>`.
- Bugs get a regression test first.
- Changes to build output also need the scripts below: the worst bugs so far were found by running
  the built binary, not by unit tests. They use the real registries, so they need a network:
  - `scripts/ci-launcher-e2e.sh` (with `CLI="node packages/cli/dist/index.js"`): the launcher, every
    hook adapter, stale-launcher fail-open, self-heal and the CI shims, from a minimal hook-style
    environment.
  - `scripts/smoke-test-packed.sh <tgz>`: the **packed** package installs into a clean prefix and
    blocks one hallucinated package per ecosystem through `scan`, the shell wrapper, the Claude Code
    hook and the git hook. Run before any release.
  - `scripts/measure-hook-latency.mjs`: hook latency against the 300 ms warm budget.

## Submitting a change

- **Behaviour changes start with an issue** (or a clear description in the pull request).
  Detection rules, thresholds and exit codes are user-visible contracts, so changing them needs a
  maintainer's agreement before the code is reviewed.
- Describe a user-visible change with `npx changeset`
  ([Changesets](https://github.com/changesets/changesets); see `.changeset/README.md`).
- Sign off every commit with `git commit -s` (see [Contribution terms](#contribution-terms)).
- Open a pull request and fill in the template.

## Contribution terms

By submitting a contribution, you agree that it is licensed under the Apache License, Version 2.0,
as provided in Section 5 of that license. Every commit must include a Signed-off-by line (use
`git commit -s`) certifying that you agree to the Developer Certificate of Origin, Version 1.1
(https://developercertificate.org), reproduced in [DCO.txt](DCO.txt). Only submit work you wrote or
have the right to submit under the Apache License, Version 2.0; do not submit code copied from other
projects with incompatible licenses or AI-generated code you cannot license on these terms. If your
employer has rights in your work, make sure you have its permission. Your sign-off, including your
name and email address, becomes a permanent public part of the project history and cannot
practically be removed.

Maintainers sign off their own commits too. A pull request's **DCO** check fails if any commit lacks
a sign-off with its author's email; fix that with `git rebase --signoff <base>` and a force-push.

## Releases

- **Patch releases** as needed. A P0 (SlopSquatShield blocking legitimate work for many users, or a
  check that can be bypassed) gets a fix within 24–48 hours.
- **Minor releases** at most once a month.
- **Major releases** for any breaking change to the config format, the `.slopsquatshield` allowlist
  or the exit codes.

The npm package is `slopsquatshield`; the same build is also published as
`@agivanttechnologies/slopsquatshield`. Either installs the `slopsquatshield` command.

## Security and conduct

Report security problems privately, as described in [SECURITY.md](SECURITY.md), never as a public
issue. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
