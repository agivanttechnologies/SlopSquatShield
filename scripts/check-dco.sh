#!/usr/bin/env bash
# Copyright 2026 Agivant Technologies Inc.
# SPDX-License-Identifier: Apache-2.0
# Checks that every non-merge commit in BASE..HEAD has a "Signed-off-by:" line naming its author's
# email (Developer Certificate of Origin, see DCO.txt). GitHub bot commits are skipped.
# Usage: scripts/check-dco.sh <base-sha> <head-sha>
set -euo pipefail

base="$1"
head="$2"
missing=0
checked=0

for sha in $(git rev-list --no-merges "$base..$head"); do
  email="$(git log -1 --format=%ae "$sha")"
  case "$email" in
    *'[bot]@users.noreply.github.com')
      echo "skip  $sha  (bot: $email)"
      continue
      ;;
  esac
  checked=$((checked + 1))
  if git log -1 --format=%B "$sha" | grep -i '^Signed-off-by: ' | grep -qiF "<$email>"; then
    echo "ok    $sha"
  else
    echo "MISSING sign-off for <$email> in $sha: $(git log -1 --format=%s "$sha")"
    missing=$((missing + 1))
  fi
done

if [ "$missing" -gt 0 ]; then
  echo
  echo "$missing of $checked commit(s) are not signed off. Add a sign-off with 'git commit -s'."
  echo "To fix existing commits: git rebase --signoff $base, then force-push the branch."
  exit 1
fi
echo "All $checked commit(s) are signed off."
