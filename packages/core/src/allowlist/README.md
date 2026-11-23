# allowlist

The `.slopsquatshield` file (FR-5): the project's list of packages whose findings are suppressed.

| Export | What it does |
|---|---|
| `parseAllowlist(text)` | One identifier per line — a bare package name, or `groupId:artifactId` for Maven. `#` starts a comment; blank lines are ignored. Returns a `Set`. |
| `isAllowlisted(identifier, set)` | Exact-match lookup. |
| `appendToAllowlist(current, identifier)` | A pure string transform: returns the new file content with the identifier appended (creating it from scratch when `current` is `undefined`). |

## Things to know

- An allowlisted identifier suppresses **every** finding for it, including a BLOCK. It also skips
  the network entirely.
- Everything here is **pure** — no file I/O. The CLI (`slopsquatshield allow`, `loadProjectContext`)
  and the editor extension read and write the file themselves and call these functions, so the
  parsing can never drift between surfaces (FR-5.2).
- `.slopsquatshield` is a **file** name, in any project directory (including your home directory if
  you run `init` there). That is why the CLI's launcher lives under `~/.config/slopsquatshield/`
  rather than at `~/.slopsquatshield/` — an early version put it there and crashed on that clash.
