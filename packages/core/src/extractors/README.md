# extractors

Turn text into a list of declared dependencies: `{ name, ecosystem, specifier?, source }`. No
network, no registry knowledge — just parsing. (`ecosystem` is `'npm' | 'pypi' | 'maven'`; see
`types.ts`.)

| File | Reads | Notes |
|---|---|---|
| `npm.ts` | a parsed `package.json` | All four dependency fields (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`), de-duplicated by name; flags a conflict when one name has different specifiers in different fields. |
| `maven.ts` | one or more `pom.xml` texts | Every `<dependency>`, resolving a missing `<version>` against the combined `<dependencyManagement>` of the whole set (parent/child POMs). |
| `python/` | Python manifests | See [`python/`](python/README.md). |
| `install-command.ts` | shell command text | See below — the one that guards the agent hooks. |
| `markdown.ts` | Markdown | Install commands inside fenced code blocks only, so prose that merely mentions a command is ignored. |
| `types.ts` | — | `Ecosystem`, `ExtractedDependency`, `DependencyConflict`. |

## `install-command.ts` reads a line the way a shell does

`extractInstallCommandDeps(text)` finds `npm install|i|add`, `pip`/`pip3 install`, `uv add` /
`uv pip install`, `poetry add` and `mvn dependency:get -Dartifact=…`. To be safe as the engine behind
an *agent hook*, it:

- **splits each line into command segments** at unquoted `;` `|` `||` `&` `&&`, parentheses, braces
  and backticks, and cuts a command off at its first unquoted redirection (`>`, `<`, `2>&1`,
  `&>file`). So `cd app && npm install some-pkg` is caught (it used to be a bypass), and
  `npm install x 2>&1 | tail` doesn't turn `2>&1` or `|` into package names;
- **strips prefixes** — `VAR=value`, `sudo`, `time`, `env`, `nohup`, … — before matching;
- **respects quotes**, so `echo "npm install x"` is not an install and `"a@^1 || ^2"` stays one token;
- **treats heredoc bodies as data** (a README or fixture being written is not an install), *unless*
  the heredoc feeds a shell (`bash <<EOF`, `sh`, `source`, `eval`, `ssh host bash`), where the body
  really runs;
- **knows which flags take a value** (`--prefix dir`, `-w pkg`, `-r file`, `-i url`, …) so the
  value isn't mistaken for a package name; file paths, URLs and tarballs are skipped.

Pasted `<dependency>…</dependency>` blocks are also extracted by default (a *document* feature,
FR-1.4). Live-command callers (the hook, the install wrapper) pass `includeXmlBlocks: false`,
because a block inside a command is almost always file content being written.

### Installs that name no package

`npm install`, `npm ci`, `pip install -r requirements.txt`, `uv sync`, `poetry install`, `mvn test`
name nothing on the command line, yet install everything a manifest lists — and an agent that edits
`package.json` with its file tool and then runs one of them used to bypass every check.
`classifyInstallCommand(text, { cwd, homeDir })` returns both halves: `named` (what
`extractInstallCommandDeps` has always returned — it is now a thin view over this) and
`manifestInstalls`, each with the directory it runs in. It tracks `cd`/`pushd` across `&&`, `;` and
newlines and follows `npm -C`/`--prefix`, `uv --directory`, `poetry -C`, `mvn -f`, `pip -r`; a
directory it can't know statically (`cd "$X"`, `cd -`) comes back `undefined` and is reported
"not verified", never guessed. `npm install -g x` is not manifest-driven. Which manifests those
installs read, and how they're verified, is `scan/manifest-install.ts` and
`scan/check-install-command.ts`.

**Known limits:** an install hidden inside a script the agent runs (`python script.py`) is invisible
to any hook that only sees the command text; a `cd` inside a `( … )` subshell is treated as if it
persisted; `npm --prefix x install` (flags before the subcommand), `python -m pip`, yarn, pnpm and
Gradle are not recognised.

## Tests

`test/extractors/` and `test/fixtures/` — one fixture set per requirement, plus
`command-segments.test.ts` for the shell-parsing rules above.
