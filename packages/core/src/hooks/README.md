# hooks

The **host-neutral** half of the AI-agent hooks (FR-12.4). One function answers every host; each
host's adapter (in `packages/cli/src/hooks/`) only formats the answer in that host's own schema.

`runHookCheck({ toolName, command }, options)` returns `{ decision, reason, summary?, verdicts, unreachable }`:

| Situation | `decision` |
|---|---|
| Not an install command (`ls`, `npm run build`, …) | `allow` — with **zero registry calls** |
| Any BLOCK verdict | `deny` |
| Any WARN verdict (and no BLOCK) | `ask` |
| Only an unreachable registry | `allow`, with a reason that says it "could not verify all of it (fail-open)" and why — never the misleading "found nothing wrong" |
| Otherwise | `allow` |

For a `deny` or `ask`, `reason` is written for the **agent**, which reads it first and decides what
to do next: one line saying what happened, one `- name (ecosystem[, declared in file]): reason` line
per flagged package, then what to do — use the correct name if it was a typo, otherwise stop and ask
the user. It never mentions `slopsquatshield allow` or any other way around the check (an agent could
run it itself). `summary` is one short line for the person (`SlopSquatShield blocked this install:
zz-ghost (does not exist).`); Cursor shows it as `user_message` and gives the agent the full reason.

Hosts differ in what they can do with `ask`: Claude Code, Cursor and Antigravity support it; Codex
has no `ask`, so its adapter turns a WARN into an allow-through. That mapping lives in the adapter,
not here.

The command text is parsed by `extractors/install-command.ts` (shell-aware: it sees an install after
`cd x &&`, ignores `|`/`2>&1`, and treats heredoc bodies as data) with `includeXmlBlocks: false`,
because a pasted `<dependency>` block inside a live command is file content, not an install.

## Tests

`test/hooks/`.
