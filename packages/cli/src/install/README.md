# install — the stable launcher

**The problem this solves.** Every surface used to run a bare `slopsquatshield`, which only resolves
if the calling host's `PATH` contains the Node install directory. Under nvm, fnm, volta or Homebrew
— and in every non-interactive hook shell — it doesn't, so the Claude Code hook exited 127 and every
agent install **silently skipped the check**.

**The fix.** `init` writes one tool-owned launcher at a fixed path that records the *current* Node
and CLI entry as absolute paths. Hooks, shell snippets, CI shims and the git hook all call the
launcher, so none of them depends on `PATH` or on which Node manager you use.

| File | Role |
|---|---|
| `self-location.ts` | `detectSelfLocation()` — where the running CLI really is (`realpath` of the bundle, through `npm link`/pnpm symlinks) and which Node runs it. `isEphemeralPath` flags a throwaway cache (`npx`, `pnpm dlx`, `bunx`, `fnm_multishells`). |
| `launcher.ts` | Builds and writes the launcher, inspects it, and repairs it. |

## Where it lives

`~/.config/slopsquatshield/bin/slopsquatshield` (a `sh` script). On Windows, `slopsquatshield.cmd` and
`slopsquatshield.ps1` sit beside it. Under WSL with a Windows `node.exe`, a second copy is written into
the distro's own home, reaching `node.exe` through its `/mnt/<drive>` path.

It is **not** at `~/.slopsquatshield/`: that is the allowlist's *file* name, and an early version
crashed `init` when run from a home directory that already held one.

## Behaviour

- **Normal:** `exec "$NODE" "$ENTRY" "$@"`.
- **Stale** (Node upgraded or removed, package reinstalled): it tries a `slopsquatshield` found on
  `PATH` (skipping itself), then **fails open, loudly**. A `hook` call exits 1 with a message — hosts
  treat that as a non-blocking error and show it; an `npm`/`pip`/`mvn` call is passed straight through
  to the real tool with the launcher and shim directories removed from `PATH`. A stale launcher never
  bricks a package manager (NFR-3.1).
- **Self-heal:** on any non-`hook` run, `refreshLauncherIfStale` rewrites a stale launcher if the
  running CLI is a persistent install. It never runs from an ephemeral install, and never throws.
- **Ephemeral installs are refused:** `init` won't write a launcher that points into an `npx`/`dlx`
  cache that will be pruned; it says to install globally.

`doctor` has a **Launcher** check, and a live run that executes each configured hook through the
launcher in a minimal environment.

## Tests

`test/install/` — launcher content per platform, idempotence, stale/self-heal behaviour, and real
`sh` runs of the generated script (POSIX only) including the stale fail-open paths.
