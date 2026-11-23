#!/usr/bin/env bash
# Copyright 2026 Agivant Technologies Inc.
# SPDX-License-Identifier: Apache-2.0
# Drives the REAL pre-commit framework (https://pre-commit.com) against this repository's
# `.pre-commit-hooks.yaml`, with the `language: node` install (FR-20.1).
#
# A consumer repo normally installs `slopsquatshield@<rev>` from npm, which doesn't exist until a
# release is published — so this builds a throwaway "hook repo" from the working tree and points
# the consumer's `additional_dependencies` at a locally packed tarball instead. That still proves
# the parts that can break: the framework can install this repo layout, the hook entry resolves, and
# only a BLOCK fails a commit.
#
#   (cd packages/cli && npm pack --pack-destination /tmp/pack)
#   bash scripts/precommit-framework-e2e.sh /tmp/pack/*slopsquatshield-*.tgz
#
# Needs `pre-commit` on PATH (pip install pre-commit) and a network (it downloads Node and queries
# the real registries). Everything runs in a throwaway directory.
set -euo pipefail

TARBALL=${1:?usage: precommit-framework-e2e.sh <slopsquatshield-X.Y.Z.tgz>}
TARBALL=$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")
command -v pre-commit >/dev/null || { echo "pre-commit is not installed (pip install pre-commit)" >&2; exit 2; }

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export HOME="$WORK/home"
export PRE_COMMIT_HOME="$WORK/pc-home"
mkdir -p "$HOME"
HOOK_REPO="$WORK/hook-repo"
CONSUMER="$WORK/consumer"
mkdir -p "$HOOK_REPO" "$CONSUMER"

pass() { echo "ok - $1"; }
fail() { echo "FAIL - $1" >&2; exit 1; }

# A hook repo shaped like this one: tracked-style files only (no node_modules, dist, docs, .git).
(cd "$REPO_ROOT" && tar --exclude=node_modules --exclude=dist --exclude=.git --exclude=docs \
  --exclude=.vscode-test --exclude='*.vsix' --exclude=.claude -cf - .) | tar -xf - -C "$HOOK_REPO"
(cd "$HOOK_REPO" && git init -q && git config user.email t@example.com && git config user.name T \
  && git add -A && git commit -q -m "hook repo")
REV=$(git -C "$HOOK_REPO" rev-parse HEAD)

cd "$CONSUMER"
git init -q && git config user.email t@example.com && git config user.name T
cat >.pre-commit-config.yaml <<EOF
repos:
  - repo: $HOOK_REPO
    rev: $REV
    hooks:
      - id: slopsquatshield
        additional_dependencies: ['$TARBALL']
EOF
git add .pre-commit-config.yaml
pre-commit install >/dev/null

write_pkg() { node -e "require('fs').writeFileSync('package.json', JSON.stringify({name:'d',dependencies:{[process.argv[1]]:'1.0.0'}}))" "$1"; }

# 1. A hallucinated dependency fails the commit — through the real framework, with the override order.
write_pkg zz-ghost-pkg-93817
git add package.json
for attempt in 1 2 3; do
  BLOCK_EXIT=0
  OUT=$(git commit -m "add dependency" 2>&1) || BLOCK_EXIT=$?
  [ "$BLOCK_EXIT" != 0 ] && break
  git reset -q --soft HEAD~1 2>/dev/null || true
  sleep 3
done
[ "$BLOCK_EXIT" != 0 ] || fail "the framework let a hallucinated manifest through"
echo "$OUT" | grep -q "blocked this commit" || { echo "$OUT" >&2; fail "the hook ran but did not explain the block"; }
echo "$OUT" | grep -q -- "--no-verify" || fail "the override order is missing from the output"
pass "a hallucinated manifest fails the commit through the real pre-commit framework"

# 2. --no-verify bypasses it.
git commit -q --no-verify -m "bypass" || fail "--no-verify did not bypass the hook"
pass "--no-verify overrides it"

# 3. A clean manifest passes.
write_pkg express
git add package.json
git commit -q -m "clean" >/dev/null 2>&1 || fail "a clean manifest was blocked"
pass "a clean manifest passes"

# 4. A commit with no manifests doesn't run the hook at all.
echo hi >note.txt && git add note.txt
OUT=$(git commit -m "notes" 2>&1) || fail "a non-manifest commit failed"
echo "$OUT" | grep -qi "slopsquatshield" && echo "$OUT" | grep -q "Passed" && fail "the hook ran for a commit with no manifests"
pass "a commit touching no manifests is untouched"

echo "pre-commit framework end-to-end passed"
