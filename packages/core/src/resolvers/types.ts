// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
/** One package name pinned to an exact resolved version in a lockfile/dependency tree. */
export interface LockfilePin {
  name: string;
  version: string;
}

/** name (or "groupId:artifactId" for Maven) -> every exact version seen pinned for it. */
export type LockfileIndex = Map<string, Set<string>>;

export function buildLockfileIndex(pins: LockfilePin[]): LockfileIndex {
  const index: LockfileIndex = new Map();
  for (const { name, version } of pins) {
    const versions = index.get(name);
    if (versions) versions.add(version);
    else index.set(name, new Set([version]));
  }
  return index;
}

/**
 * Fast-path lookup (FR-3.4): a name that appears pinned in the lockfile was already
 * resolved by npm/pip/poetry/Maven against the real registry at lock time, so it's
 * treated as verified with zero network calls here. Returns the pinned version(s) found,
 * or `undefined` if the lockfile has no entry for this name at all.
 */
export function resolveViaLockfile(name: string, index: LockfileIndex): Set<string> | undefined {
  return index.get(name);
}
