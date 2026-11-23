# SlopSquatShield

**Checks the packages you or your AI coding agent install, and blocks the ones that don't exist or look like traps.**

AI coding agents sometimes invent package names. Attackers register those names (this is called *slopsquatting*) so that the next agent making the same mistake installs their code. SlopSquatShield looks each package up in its public registry first.

- Works with **npm, PyPI and Maven**.
- Runs in your **terminal**, in **AI agents** (Claude Code, Cursor, Codex CLI, Antigravity), on **git commit** and in **IDEs** (VS Code, Cursor, Windsurf, VSCodium, Antigravity).

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Where it runs](#where-it-runs) · [Using it](#using-it) · [Privacy](#privacy) · [What it doesn't do](#what-it-doesnt-do) · [Reference](#reference) · [Uninstall](#uninstall)

## Quickstart

You need Node.js 22 or newer.

```bash
npm install -g slopsquatshield
slopsquatshield init --all    # set up the shell wrapper and a hook for each AI agent it finds
slopsquatshield doctor        # check the setup; it tells you how to fix anything missing
```

That's it. Keep using `npm`, `pip` and `mvn` as usual.

## How it works

For each package, SlopSquatShield asks the registry a few questions:

| Check | If yes |
|---|---|
| The package doesn't exist | **BLOCK** |
| It was published less than 14 days ago | WARN |
| It has fewer than 500 downloads a week | WARN |
| Its name is 1–2 letters away from a popular package | WARN |
| It has no link to a source repository | WARN |
| It matches a name you marked as private, but it's on the public registry | **BLOCK** |

**Two or more WARNs on the same package add up to a BLOCK.** There's no hidden score.

A few details:

- Packages with 100,000+ weekly downloads never get the look-alike WARN (so `vitest` isn't flagged for looking like `vite`).
- Maven publishes no download counts, so Maven packages skip the download check.
- If a registry can't be reached, nothing is blocked. You get a "not verified" message and exit code `3`.
- You can change the thresholds: see [Configuration](#configuration).

Files it reads:

| Language | Registry | Files |
|---|---|---|
| JavaScript / TypeScript | npm | `package.json`, `package-lock.json` |
| Python | PyPI | `requirements.txt`, `pyproject.toml`, `Pipfile`, lockfiles |
| Java | Maven Central | `pom.xml` (including multi-module and parent POMs) |

For Maven, it uses your own JDK and Maven if they're installed. `doctor` tells you if they're missing.

## Where it runs

| Where | What it does | Can it stop an install? |
|---|---|---|
| **Shell wrapper** | Checks the package, then runs the real `npm`/`pip`/`mvn` | Yes |
| **AI agent hooks** | Checks the agent's install command before it runs | Yes. The agent can't skip it |
| **CI shims** (`init --ci`) | The shell wrapper's checks, for CI shells | Yes, if they're on `PATH` |
| **`slopsquatshield scan`** | Checks every manifest in a project | No, it reports |
| **Git pre-commit hook** | Checks the manifests you staged. Only a BLOCK fails the commit | No, it reports |
| **IDE extension** | Marks problems in your manifests as you edit | No, it reports |

## Using it

### Scan a project

Run `slopsquatshield scan .` to check every manifest in a project. It exits with one of the [exit codes](#exit-codes).

- `--json` prints machine-readable output.
- `--report-only` shows the same results but always exits `0`. Use it to try the tool without failing anything.
- `--maven-tree` also runs `mvn dependency:tree` in the project to find the Maven versions it resolves. Use it only on projects you trust: Maven runs the project's own configuration and plugins.

### With your AI agent

`slopsquatshield init --all` adds a hook to each AI agent it finds on your machine.

| Agent | Config file |
|---|---|
| Claude Code | `~/.claude/settings.json` |
| Cursor | `~/.cursor/hooks.json` |
| Codex CLI | `~/.codex/hooks.json` |
| Antigravity (desktop app, CLI) | `~/.gemini/config/hooks.json` |

- **BLOCK:** the agent's command is denied.
- **WARN:** the agent asks you first. Codex CLI can't ask yet, so it lets the command through.
- **Nothing wrong:** the hook stays quiet, so your agent's normal approval prompts still work.

To set up one agent only, use `--claude-code`, `--cursor`, `--codex` or `--antigravity`. Add `--project` to write into the current project instead of your user settings.

### On git commit

The commit check is advisory: only a BLOCK fails the commit.

With the [pre-commit](https://pre-commit.com) framework, add this to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/agivanttechnologies/SlopSquatShield
    rev: v1.0.0
    hooks:
      - id: slopsquatshield
```

Without the framework, run `slopsquatshield init --git-hook`. It adds to your existing shell hook if there is one, and won't touch a hook written in another language.

### In your IDE

The IDE extension works in VS Code, Cursor, Windsurf, VSCodium and Antigravity. It marks dependencies in `package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile` and `pom.xml`:

- red for a BLOCK,
- yellow for a WARN,
- blue when a registry couldn't be reached.

Quick fixes can remove the dependency, allow it, or suggest the name you probably meant. The extension only reports; it can't stop an install. See its [README](packages/extension/README.md).

### When a package is blocked

1. **Fix it.** Correct the name, or remove the dependency.
2. **Allow it**, if you're sure it's real: `slopsquatshield allow <package>`. This adds it to the project's [allowlist file](#allowlist-file).
3. **Skip the check once:**
   - bash or zsh: `command npm install …` (same for `pip` and `mvn`)
   - PowerShell: `npm.cmd install …`
   - git: `git commit --no-verify`

If SlopSquatShield itself gets in your way, you can [uninstall](#uninstall) it.

## Privacy

- **Nothing is sent to Agivant Technologies Inc.** There's no telemetry.
- **Only package names leave your machine.** They go to the public services that answer for them: deps.dev, the npm registry and `api.npmjs.org`, PyPI and `pypistats.org`, and Maven Central. Like any web request, these services see your IP address.
- **Results are cached** on your machine, so repeat checks often need no network.

Full statement: [PRIVACY.md](PRIVACY.md).

### What `init` changes on your machine

- A **launcher** in `~/.config/slopsquatshield/bin/`, which the wrapper and hooks call. Re-run `init` if you move or reinstall the CLI. (Install globally first; `init` won't run from an `npx` cache.)
- The **shell wrapper**, a marked block in `~/.bashrc`, `~/.zshrc` or your PowerShell profile.
- **One hook entry** in each agent's config file (see [the table above](#with-your-ai-agent)).
- A **`.slopsquatshield`** allowlist in the project, if there isn't one.
- Only if you ask: CI shims (`--ci`) and a git pre-commit hook (`--git-hook`).

[`slopsquatshield uninstall`](#uninstall) removes all of these except your allowlist.

## What it doesn't do

**What it doesn't check**

- **Package code.** It isn't a malware scanner. It only checks registry information: whether a package exists, its age, downloads and repository link. A real package can still be malicious.
- **The whole dependency tree.** It checks the dependencies your manifest lists, not their dependencies.
- **Made-up functions.** It catches invented package names, not invented methods inside a real package.
- **Fixes.** It reports or refuses a package; it never swaps in a different one.

**Coverage**

- **Only npm, PyPI and Maven.** No Cargo, Go, NuGet or RubyGems.
- **The shell wrapper covers `npm`, `pip` and `mvn` only**, not pnpm, yarn, Gradle, uv or poetry. The agent hooks also understand `uv` and `poetry`.
- **Maven has no download check**, so a bad Maven package is harder to spot.
- **No CI bot or pull-request checks.** `init --ci` covers installs in CI shells, but nothing scans your pipelines.
- **Not covered:** Antigravity's extension inside JetBrains, Zed or Visual Studio.
- **Allowlist entries apply to every ecosystem.** Allowing `internal-utils` allows it on npm *and* PyPI.

## Reference

### Exit codes

Every part of SlopSquatShield uses the same four codes:

| Code | Meaning |
|---|---|
| `0` | Clean: everything checked, nothing found |
| `1` | Suspicious: WARNs only |
| `2` | Blocked: at least one BLOCK |
| `3` | Couldn't check: a registry was unreachable or a manifest couldn't be read. This is **not** a finding, but it's never reported as clean either |

The pre-commit hook only fails on `2`.

### Allowlist file

`.slopsquatshield` at the project root lists packages to trust: one name per line (`groupId:artifactId` for Maven), with `#` for comments. An allowed package is never flagged, not even with a BLOCK.

Add to it by hand, with `slopsquatshield allow <package>`, or from the IDE extension's quick fix.

### Configuration

No configuration is needed. To change thresholds or to declare your private package names, add a `.slopsquatshieldrc` (JSON) file at the project root, or put the same object under a `"slopsquatshield"` key in `package.json`. If both exist, `.slopsquatshieldrc` wins.

```json
{
  "thresholds": { "minAgeDays": 30 },
  "privateScopes": { "npm": ["@mycompany"] }
}
```

Only list what you want to change; everything else keeps its default.

| Key | Default | Meaning |
|---|---|---|
| `thresholds.minAgeDays` | `14` | Younger packages get a WARN |
| `thresholds.minWeeklyDownloads` | `500` | Fewer weekly downloads get a WARN (npm and PyPI) |
| `thresholds.maxNameSimilarityDistance` | `2` | Names this close to a popular package get a WARN |
| `privateScopes.npm` | none | npm scopes you only publish privately |
| `privateScopes.pypi` | none | A regular expression for your private PyPI names |
| `privateScopes.maven` | none | `groupId` prefixes you only publish privately |

If a private name turns up on the **public** registry, that's a BLOCK (a "dependency confusion" attack).

A mistake in the config file is reported with its line and column, and the defaults are used instead. A typo never stops an install.

## Uninstall

```bash
slopsquatshield uninstall --dry-run   # show what would be removed
slopsquatshield uninstall             # remove it
npm uninstall -g slopsquatshield      # then remove the program
```

`uninstall` only removes what `init` added. Your other settings stay, and your `.slopsquatshield` and `.slopsquatshieldrc` files are never deleted (`--purge` also clears the cache). Remove the hooks **before** removing the program, or your agents will report an error on every command.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately: see [SECURITY.md](SECURITY.md).

## Disclaimer

SlopSquatShield is provided "AS IS," without warranties or conditions of any kind, and Agivant Technologies Inc.'s liability is limited, as set out in Sections 7 and 8 of the [LICENSE](LICENSE) (Apache License, Version 2.0). SlopSquatShield checks package names against information published by public package registries and package-metadata services at the time of the check. It does not download, run, or analyze package code. For Maven projects it may run your own `mvn dependency:tree`, which uses Maven's normal download behaviour. It cannot detect every malicious or suspicious package. It may block or warn about legitimate packages and may fail to block or warn about harmful ones. Registry information may be incomplete, inaccurate, delayed, or unavailable; if a registry cannot be reached, SlopSquatShield allows the install, prints a warning and exits with code 3, as described in [Exit codes](#exit-codes). SlopSquatShield does not replace dependency review, software composition analysis, or your own security processes. You remain responsible for every package that you, your team, or any AI coding assistant acting for you installs. Your use of each registry and service remains subject to its own terms. Nothing in this notice or in the LICENSE excludes or limits any liability or right that cannot be excluded or limited under the law that applies to you.

### Independence and trademarks

SlopSquatShield is an independent project maintained by Agivant Technologies Inc. It is not affiliated with, sponsored by, or endorsed by GitHub, npm, Inc., the Python Software Foundation, Sonatype, the Apache Software Foundation, Microsoft, the Eclipse Foundation, Google, or the provider of any AI tool it works with, including Anthropic (Claude Code), Anysphere (Cursor), OpenAI (Codex CLI) and Google (Antigravity). npm, PyPI, Maven, Maven Central, deps.dev, Visual Studio Code, Open VSX, and the names of AI tools and editors are trademarks of their respective owners and are used here only to identify compatibility. The Apache License does not grant permission to use the SlopSquatShield or Agivant names or marks; modified versions should be distributed under a different name.

## License

Apache License 2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Copyright 2026 Agivant Technologies Inc.
