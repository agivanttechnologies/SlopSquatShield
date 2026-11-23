#!/usr/bin/env bash
# Copyright 2026 Agivant Technologies Inc.
# SPDX-License-Identifier: Apache-2.0
# The end-to-end smoke test before a release is tagged: install the PACKED package
# — not the workspace — into a clean prefix, and prove that, against the real registries, one
# known-hallucinated package per ecosystem (npm / PyPI / Maven) is BLOCKed by `scan`, by the shell
# wrapper, by the Claude Code hook, and by the git pre-commit hook.
#
#   npm run build && (cd packages/cli && npm pack --pack-destination /tmp/pack)
#   bash scripts/smoke-test-packed.sh /tmp/pack/*slopsquatshield-*.tgz
#
# Everything runs in a throwaway HOME and prefix; nothing touches the real machine's config.
set -euo pipefail

TARBALL=${1:?usage: smoke-test-packed.sh <slopsquatshield-X.Y.Z.tgz>}
TARBALL=$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"
PREFIX="$WORK/prefix"
PROJECT="$WORK/project"
mkdir -p "$HOME/.claude" "$PREFIX" "$PROJECT"
CLI="$PREFIX/bin/slopsquatshield"
SYSTEM_PATH=/usr/local/bin:/usr/bin:/bin

pass() { echo "ok - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }

# The three hallucinations: made-up names that exist on no registry.
NPM_GHOST=zz-ghost-npm-93817
PYPI_GHOST=zz-ghost-py-93817
MAVEN_GHOST=org.zzghost.nonexistent:ghost-artifact-93817

# --- 1. install the packed tarball into a clean prefix ---------------------------------------
npm install --global --prefix "$PREFIX" "$TARBALL" >"$WORK/install.log" 2>&1 || {
  cat "$WORK/install.log" >&2
  fail "the packed tarball does not install from npm (a runtime dependency may be unpublishable)"
}
[ -x "$CLI" ] || fail "the tarball installed no slopsquatshield binary"
pass "packed tarball installs into a clean prefix"

EXPECTED=$(tar -xzOf "$TARBALL" package/package.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")
[ "$("$CLI" --version)" = "$EXPECTED" ] || fail "--version is '$("$CLI" --version)', the package says '$EXPECTED'"
pass "--version matches the package version ($EXPECTED)"

# --- 2. a scratch project with one hallucination per ecosystem -------------------------------
node -e "require('fs').writeFileSync('$PROJECT/package.json', JSON.stringify({name:'smoke',dependencies:{'$NPM_GHOST':'1.0.0'}}))"
printf '%s==1.0.0\n' "$PYPI_GHOST" >"$PROJECT/requirements.txt"
node -e "
const [g,a]='$MAVEN_GHOST'.split(':');
require('fs').writeFileSync('$PROJECT/pom.xml',
  '<project><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>smoke</artifactId><version>1</version>' +
  '<dependencies><dependency><groupId>'+g+'</groupId><artifactId>'+a+'</artifactId><version>1.0</version></dependency></dependencies></project>');
"

# Needs the live registries; retry a few times so a brief outage does not fail a release check.
SCAN_EXIT=0
for attempt in 1 2 3; do
  SCAN_EXIT=0
  (cd "$PROJECT" && "$CLI" scan . --json >"$WORK/scan.json" 2>"$WORK/scan.err") || SCAN_EXIT=$?
  [ "$SCAN_EXIT" = 2 ] && break
  sleep 3
done
[ "$SCAN_EXIT" = 2 ] || { cat "$WORK/scan.json" "$WORK/scan.err" >&2; fail "scan exited $SCAN_EXIT, expected 2 (BLOCK)"; }
for ghost in "$NPM_GHOST" "$PYPI_GHOST" "$MAVEN_GHOST"; do
  node -e "
    const r = JSON.parse(require('fs').readFileSync('$WORK/scan.json','utf8'));
    const f = r.findings.find((x) => x.identifier === '$ghost');
    process.exit(f && f.tier === 'BLOCK' ? 0 : 1);
  " || { cat "$WORK/scan.json" >&2; fail "scan did not BLOCK $ghost"; }
done
pass "scan BLOCKs one hallucinated package per ecosystem (npm, PyPI, Maven), exit 2"

# --- 3. the shell wrapper --------------------------------------------------------------------
(cd "$PROJECT" && "$CLI" init --shell >/dev/null)
WRAP_EXIT=0
WRAP_OUT=$(cd "$PROJECT" && env -i HOME="$HOME" PATH="$SYSTEM_PATH" bash --rcfile "$HOME/.bashrc" -ic "npm install $NPM_GHOST" 2>&1) || WRAP_EXIT=$?
[ "$WRAP_EXIT" = 2 ] || { echo "$WRAP_OUT" >&2; fail "the shell wrapper exited $WRAP_EXIT, expected 2"; }
[ ! -d "$PROJECT/node_modules" ] || fail "the wrapper blocked but node_modules appeared"
pass "the shell wrapper BLOCKs an install (exit 2, nothing installed)"

# --- 4. the Claude Code hook, run the way a host runs it -------------------------------------
(cd "$PROJECT" && "$CLI" init --claude-code >/dev/null)
HOOK='"$HOME/.config/slopsquatshield/bin/slopsquatshield" hook claude-code'
for attempt in 1 2 3; do
  HOOK_OUT=$(printf '{"tool_name":"Bash","tool_input":{"command":"npm install %s"}}' "$NPM_GHOST" |
    env -i HOME="$HOME" PATH="$SYSTEM_PATH" sh -c "$HOOK")
  echo "$HOOK_OUT" | grep -q '"permissionDecision":"deny"' && break
  sleep 3
done
echo "$HOOK_OUT" | grep -q '"permissionDecision":"deny"' || fail "the Claude Code hook did not deny: $HOOK_OUT"
pass "the Claude Code hook DENYs a hallucinated install from a minimal environment"

# --- 5. the git pre-commit hook (direct mode) ------------------------------------------------
(cd "$PROJECT" && git init -q && git config user.email t@example.com && git config user.name T && "$CLI" init --git-hook >/dev/null)
(cd "$PROJECT" && git add package.json)
COMMIT_EXIT=0
(cd "$PROJECT" && git commit -q -m smoke >/dev/null 2>&1) || COMMIT_EXIT=$?
[ "$COMMIT_EXIT" != 0 ] || fail "the pre-commit hook let a hallucinated manifest through"
(cd "$PROJECT" && git commit -q --no-verify -m smoke >/dev/null 2>&1) || fail "--no-verify did not bypass the hook"
pass "the pre-commit hook blocks the commit; --no-verify overrides it"

# --- 6. doctor runs and sees the launcher ----------------------------------------------------
DOCTOR=$(cd "$PROJECT" && "$CLI" doctor 2>&1 || true)
# "  ✓ Launcher", or "  ok Launcher" where the terminal can't be trusted with Unicode.
echo "$DOCTOR" | grep -Eq '^  (✓|ok) Launcher ' || { echo "$DOCTOR" >&2; fail "doctor does not report a working launcher"; }
pass "doctor reports a working launcher"

echo "packed-package smoke test passed ($EXPECTED)"
