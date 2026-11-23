# SlopSquatShield for VS Code

Shows warnings in your editor when a dependency in `package.json`, `requirements.txt`,
`pyproject.toml`, `Pipfile` or `pom.xml` looks like a **hallucinated** package — a name an AI
assistant (or a tired human) made up that doesn't exist on the registry — or a
**slopsquat-style** trap: a real package that carries the warning signs of one registered to
catch AI-generated installs (brand new, almost no downloads, no repository link, a name a typo
away from a popular package).

> **This extension is advisory. It reports; it does not enforce anything.**
> It cannot stop an install. Install-time enforcement comes from the
> [SlopSquatShield command-line tool](https://github.com/agivanttechnologies/SlopSquatShield#readme):
> its shell wrapper and agent hooks are where a bad package is actually blocked. Treat the
> squiggles here as an early heads-up while you edit.

## Installing from a `.vsix`

Install it from inside the window you'll use: **Extensions → ⋯ → Install from VSIX…**. If you
use `code --install-extension slopsquatshield-vscode.vsix` instead, add `--profile "<name>"` when
you work in a VS Code profile other than Default: an extension installed into another profile
shows as installed but never loads in your window, and says nothing about it. The same applies to
the WSL and remote sides of VS Code, which keep their own extension lists.

## What you see

| Finding | Shown as |
|---|---|
| Package does not exist on its registry, or several warning signs together | **Error** |
| One warning sign (new, rarely downloaded, no repo link, look-alike name) | **Warning** |
| The registry couldn't be reached, or the manifest couldn't be read | **Information** — never an error: being offline is not a finding |

Every message names the package and says *why* in plain English
(`zz-ghost: Does not exist on the npm registry.`). The status bar shows the worst result across the
workspace (clean · N warnings · N blocked · N not verified), the same four outcomes as the command
line's exit codes `0`/`1`/`2`/`3`. Click it to open the Problems panel.

### Quick fixes (the lightbulb)

- **Remove "x" from this manifest** — deletes the declaration (and fixes a dangling comma in JSON).
- **Add "x" to .slopsquatshield** — suppresses the finding by adding it to the `.slopsquatshield`
  file next to that manifest: the same file the command line, shell wrapper and agent hooks read
  when you install from that folder. A message shows the file it wrote.
- **Did you mean "y"?** — only when the finding is a look-alike of a popular package.

## Settings

| Setting | Default | |
|---|---|---|
| `slopsquatshield.enable` | `true` | Turn the checks on or off. |
| `slopsquatshield.debounceMs` | `500` | Wait this long after open/save before checking a manifest. |

Command: **SlopSquatShield: Scan workspace manifests**.

## Privacy

SlopSquatShield collects no personal data and sends nothing to Agivant Technologies Inc.; package checks go directly from your machine to public registries. Details: [PRIVACY.md](https://github.com/agivanttechnologies/SlopSquatShield/blob/main/PRIVACY.md).

Checking a dependency sends **its name** to the public registry services — deps.dev, the npm registry and `api.npmjs.org`, PyPI and `pypistats.org` (PyPI's download counts), and Maven Central — exactly as the command-line tool does. Nothing else leaves your machine: no file
contents, no paths, no telemetry. Results are cached in memory for the editor session only.
Turn `slopsquatshield.enable` off to stop all lookups.

## Limits worth knowing

- Advisory only (see above). A finding here is not a guarantee, and a clean result is not either.
- It reads manifests, not lockfiles or your source code, and doesn't inspect what a package does.
- For `pom.xml` it checks the dependencies each file declares; it doesn't run Maven.
- The in-memory cache starts empty each time the editor starts, so the first check of a session
  makes network calls the command line (which keeps a disk cache) might not.

## Disclaimer

SlopSquatShield is provided "AS IS," without warranties or conditions of any kind, and Agivant Technologies Inc.'s liability is limited, as set out in Sections 7 and 8 of the [LICENSE](LICENSE) (Apache License, Version 2.0). SlopSquatShield checks package names against information published by public package registries and package-metadata services at the time of the check. It does not download, run, or analyze package code. It cannot detect every malicious or suspicious package. It may block or warn about legitimate packages and may fail to block or warn about harmful ones. Registry information may be incomplete, inaccurate, delayed, or unavailable; if a registry cannot be reached, this extension marks the dependency as not verified (an information note, not a finding), and the command-line tool allows the install, prints a warning and exits with code 3. SlopSquatShield does not replace dependency review, software composition analysis, or your own security processes. You remain responsible for every package that you, your team, or any AI coding assistant acting for you installs. Your use of each registry and service remains subject to its own terms. Nothing in this notice or in the LICENSE excludes or limits any liability or right that cannot be excluded or limited under the law that applies to you.

### Independence and trademarks

SlopSquatShield is an independent project maintained by Agivant Technologies Inc. It is not affiliated with, sponsored by, or endorsed by GitHub, npm, Inc., the Python Software Foundation, Sonatype, the Apache Software Foundation, Microsoft, the Eclipse Foundation, Google, or the provider of any AI tool it works with, including Anthropic (Claude Code), Anysphere (Cursor), OpenAI (Codex CLI) and Google (Antigravity). npm, PyPI, Maven, Maven Central, deps.dev, Visual Studio Code, Open VSX, and the names of AI tools and editors are trademarks of their respective owners and are used here only to identify compatibility. The Apache License does not grant permission to use the SlopSquatShield or Agivant names or marks; modified versions should be distributed under a different name.

## License

Apache License 2.0: see [LICENSE](LICENSE).

Copyright 2026 Agivant Technologies Inc.
