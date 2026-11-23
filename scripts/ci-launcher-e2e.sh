#!/usr/bin/env bash
# Copyright 2026 Agivant Technologies Inc.
# SPDX-License-Identifier: Apache-2.0
# End-to-end check of the launcher: everything runs in an isolated HOME, and the hook is
# invoked the way a host does — a non-interactive `sh` with only a system PATH (no Node dir on
# it), which is exactly what produced exit 127 under nvm (seen 2026-10-01).
#
# CLI="..." overrides how the CLI is invoked (default: `slopsquatshield` on PATH).
# Needs the real npm registry for the BLOCK case (same as scripts/smoke-test-packed.sh).
set -euo pipefail

CLI=${CLI:-slopsquatshield}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"
mkdir -p "$HOME"
# Run from the home dir with an allowlist *file* named .slopsquatshield already there — what
# `init` in ~ leaves behind. The launcher once collided with that name (ENOTDIR).
printf '# allowlist\n' > "$HOME/.slopsquatshield"
cd "$HOME"

SYSTEM_PATH=/usr/local/bin:/usr/bin:/bin
HOOK='"$HOME/.config/slopsquatshield/bin/slopsquatshield" hook claude-code'
LAUNCHER="$HOME/.config/slopsquatshield/bin/slopsquatshield"

# GNU `timeout` is not on macOS runners; perl's alarm is, and it survives the exec.
with_timeout() {
  if command -v timeout >/dev/null; then timeout "$@"; else perl -e 'alarm shift; exec @ARGV' "$@"; fi
}
pass() { echo "ok - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }

# Runs the configured hook command in a minimal environment; prints stdout, sets HOOK_EXIT.
run_hook() {
  HOOK_EXIT=0
  HOOK_OUT=$(printf '%s' "$1" | env -i HOME="$HOME" PATH="$SYSTEM_PATH" sh -c "$HOOK" 2>"$WORK/stderr") || HOOK_EXIT=$?
}

# --all (FR-14.1) writes a hook only for agent hosts it finds, so make three of them "installed".
mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.gemini"
$CLI init --all >/dev/null
[ -x "$LAUNCHER" ] || fail "launcher was not written"
grep -q 'hook claude-code' "$HOME/.claude/settings.json" || fail "hook not in user-level settings"
grep -q 'hook codex' "$HOME/.codex/hooks.json" || fail "codex hook not written"
grep -q 'hook antigravity' "$HOME/.gemini/config/hooks.json" || fail "antigravity hook not written"
[ ! -e "$HOME/.cursor" ] || fail "init --all wrote a Cursor config for a host that was not found"
[ -f "$HOME/.slopsquatshield" ] || fail "init clobbered the allowlist file"
pass "init --all wrote launcher + user-level hook (alongside an allowlist file in ~)"

# 1. Non-install command: allowed, from a minimal env (would be exit 127 with a bare name).
#    "Allowed" is exit 0 with NO output: an explicit "allow" would skip the user's own permission
#    prompt in Claude Code, so the hook stays silent and the normal flow continues.
run_hook '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
[ "$HOOK_EXIT" = 0 ] && [ -z "$HOOK_OUT" ] || fail "non-install should be silent exit 0 (exit $HOOK_EXIT): $HOOK_OUT $(cat "$WORK/stderr")"
pass "hook allows a non-install command from a minimal environment (silently, no approval granted)"

# 2. Nonexistent package: denied.
# Needs the live registry; if it is briefly unreachable the hook fails open by design (NFR-3.1),
# so retry a few times rather than flake.
for attempt in 1 2 3; do
  run_hook '{"tool_name":"Bash","tool_input":{"command":"npm install zz-slopsquat-nonexistent-pkg-93817"}}'
  echo "$HOOK_OUT" | grep -q '"deny"' && break
  sleep 3
done
echo "$HOOK_OUT" | grep -q '"deny"' || fail "nonexistent package not denied after 3 tries: $HOOK_OUT $(cat "$WORK/stderr")"
pass "hook denies a nonexistent package"

# 2b. Codex and Antigravity (each host's own stdin/stdout contract, same minimal env).
run_host() { # host payload -> sets HOST_OUT
  HOST_OUT=$(printf '%s' "$2" | env -i HOME="$HOME" PATH="$SYSTEM_PATH" sh -c "\"$LAUNCHER\" hook $1" 2>"$WORK/stderr") || fail "hook $1 exited non-zero: $(cat "$WORK/stderr")"
}
BAD='npm install zz-slopsquat-nonexistent-pkg-93817'
for attempt in 1 2 3; do
  run_host codex "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$BAD\"}}"
  echo "$HOST_OUT" | grep -q '"permissionDecision":"deny"' && break
  sleep 3
done
echo "$HOST_OUT" | grep -q '"permissionDecision":"deny"' || fail "codex did not deny a nonexistent package: $HOST_OUT"
pass "codex hook denies a nonexistent package"
run_host codex '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
[ -z "$HOST_OUT" ] || fail "codex should answer an allow with empty output, got: $HOST_OUT"
pass "codex hook allows (empty output) a non-install command"
for attempt in 1 2 3; do
  run_host antigravity "{\"toolCall\":{\"name\":\"run_command\",\"args\":{\"CommandLine\":\"$BAD\"}}}"
  echo "$HOST_OUT" | grep -q '"decision":"deny"' && break
  sleep 3
done
echo "$HOST_OUT" | grep -q '"decision":"deny"' || fail "antigravity did not deny a nonexistent package: $HOST_OUT"
pass "antigravity hook denies a nonexistent package"
run_host antigravity '{"toolCall":{"name":"run_command","args":{"CommandLine":"ls"}}}'
[ -z "$HOST_OUT" ] || fail "antigravity should answer an allow with empty output, got: $HOST_OUT"
pass "antigravity hook allows (empty output) a non-install command"
run_host codex 'this is not json'
[ -z "$HOST_OUT" ] || fail "malformed input should fail open with no output, got: $HOST_OUT"
pass "malformed hook input fails open"

# 3. Stale launcher: fails open, loudly (hook exit 1 + repair message), never blocks.
cp "$LAUNCHER" "$WORK/launcher.good"
sed -i.bak "s#^NODE=.*#NODE='/gone/node'#" "$LAUNCHER"
run_hook '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
[ "$HOOK_EXIT" = 1 ] && grep -q 'launcher is stale' "$WORK/stderr" || fail "stale launcher did not fail open loudly (exit $HOOK_EXIT)"
pass "stale launcher fails open with a repair message"

# 4. Self-heal: any non-hook CLI run from a persistent install repairs the launcher.
$CLI doctor >/dev/null 2>&1 || true
grep -q "^NODE='/gone/node'" "$LAUNCHER" && fail "launcher was not self-healed"
run_hook '{"tool_name":"Bash","tool_input":{"command":"ls"}}'
[ "$HOOK_EXIT" = 0 ] || fail "hook still broken after self-heal (exit $HOOK_EXIT)"
pass "CLI self-heals a stale launcher"

# 5. CI shims must not recurse: the shim -> launcher -> CLI -> *real* npm.
REAL_VERSION=$(npm --version)
$CLI init --ci >/dev/null
VERSION=$(PATH="$HOME/.config/slopsquatshield/shims:$PATH" with_timeout 60 npm --version) || fail "npm via CI shim failed or recursed"
# Also guards the wrapper forwarding the real tool's own flags (it once answered with our version).
[ "$VERSION" = "$REAL_VERSION" ] || fail "npm via CI shim printed '$VERSION', real npm is '$REAL_VERSION'"
pass "CI shim reaches the real npm without recursing ($VERSION)"

# 6. Re-running init is a no-op for the hook config.
$CLI init --claude-code --json | grep -q '"already-installed"' || fail "second init was not idempotent"
pass "init is idempotent"

# 7. uninstall is the inverse of init: a dry run changes nothing, the real run removes everything
#    init wrote (and nothing else), and the person's own allowlist file survives.
$CLI init --shell >/dev/null
grep -q "slopsquatshield shell wrapper" "$HOME/.bashrc" || fail "setup for the uninstall check: wrapper not written"
$CLI uninstall --dry-run >/dev/null || fail "uninstall --dry-run failed"
[ -d "$HOME/.config/slopsquatshield" ] && grep -q "slopsquatshield shell wrapper" "$HOME/.bashrc" \
  || fail "uninstall --dry-run changed something"
$CLI uninstall >/dev/null || fail "uninstall failed"
[ ! -e "$HOME/.config/slopsquatshield" ] || fail "uninstall left the launcher directory"
# A profile that held only our block is deleted, so "gone" means: missing, or present without us.
free_of_us() { [ ! -e "$1" ] || ! grep -q "slopsquatshield" "$1"; }
free_of_us "$HOME/.bashrc" || fail "uninstall left the shell wrapper in .bashrc"
free_of_us "$HOME/.claude/settings.json" || fail "uninstall left the Claude Code hook"
[ -f "$HOME/.slopsquatshield" ] || fail "uninstall deleted the allowlist file, which is the person's own"
pass "uninstall removes what init wrote, and only that"

echo "all launcher e2e checks passed"
