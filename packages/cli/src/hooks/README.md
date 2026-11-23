# hooks

Everything for the AI-agent hooks (FR-12) and the git pre-commit hook (FR-20.4). The detection is in
core's `runHookCheck`; this folder wraps it per host and writes each host's config.

## Running a hook

```
stdin (host JSON) → hook-input.ts → hook-runner.ts → core runHookCheck → <host>.ts → stdout
```

| File | Role |
|---|---|
| `hook-input.ts` | `parseHookInput(host, raw)` — normalises each host's stdin to `{ toolName, command, cwd }`. Claude Code and Codex share one shape; **Cursor's own payload** has a top-level `command`/`cwd`/`workspace_roots` (and sets `caller: 'cursor'`, as does a Cursor running a hook it imported from `~/.claude`); **Antigravity's differs** (`toolCall.name === 'run_command'`, `toolCall.args.CommandLine`). Unparseable input returns `undefined` → the caller fails open. |
| `hook-runner.ts` | `runHookCheckFromStdin` — parses, loads the project allowlist/config (using the host's `cwd` when this process can see it, else its own), and calls core. An unparseable payload is an `allow`, never a crash. |
| `lazy-cache.ts` | `LazyRegistryCache` — opens SQLite only on first use (a non-install command never loads the native module), and runs **without a cache** (one stderr warning) if it can't be opened at all. |
| `claude-code.ts`, `cursor.ts`, `codex.ts`, `antigravity.ts` | One formatter per host: turn the host-neutral decision into that host's stdout. **Claude Code:** `permissionDecision` deny/ask in `hookSpecificOutput`; **an allow prints nothing**, because an explicit `"allow"` makes Claude Code skip the user's own permission prompt (a guard must only ever narrow what the agent may do). **Cursor:** its documented flat `{permission, user_message, agent_message}` (allow is explicit — Cursor blocks on an empty reply). **Codex:** `deny` JSON on BLOCK, *no output* otherwise (Codex has no `ask`; a WARN's reason goes to stderr). **Antigravity:** `{"decision": …, "reason": …}` for deny/ask, nothing for allow. All exit 0; the decision travels in the body. |

## Writing a host's config

`init` calls these; each is idempotent, upgrades a legacy entry **in place** (never duplicates it),
and refuses to overwrite a file that isn't valid JSON.

| File | Writes | Notes |
|---|---|---|
| `matcher-group-config.ts` | the shared `hooks.PreToolUse[]` shape | Claude Code's `settings.json` and Codex's `hooks.json` share it, so one reader/writer serves both. |
| `claude-code-config.ts` | `~/.claude/settings.json` (or the project's `.claude/`) | Matcher `Bash`. |
| `codex-config.ts` | `~/.codex/hooks.json` | Matcher `Bash`, `timeout: 30` (Codex's own default is 600s). |
| `cursor-config.ts` | `~/.cursor/hooks.json` | `beforeShellExecution`. |
| `antigravity-config.ts` | `~/.gemini/config/hooks.json` or `.agents/hooks.json` | A map of *named* hooks, no top-level `hooks` key; matcher `run_command`. |
| `hook-command.ts` | — | The exact command string each host runs (the launcher, by fixed path) and `isOurHookCommand`, which recognises legacy bare-name and hand-written absolute-path entries so they get upgraded, not duplicated. |
| `git-hook.ts` | `.git/hooks/pre-commit` | A marked block calling `precommit --staged`. Honours `core.hooksPath`; chains with an existing shell hook (ours runs first); refuses a hook in another language. |

## Verification status

The Claude Code hook has been seen firing in a real session. Cursor, Codex and Antigravity are built
to their documented contracts and tested with realistic input, but **not yet seen firing in the real
applications.** Say so wherever you document them.

Tests: `test/hooks/`.
