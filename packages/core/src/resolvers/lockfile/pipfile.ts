// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { LockfilePin } from '../types.js';

interface PipfileLockEntry {
  version?: string;
}

interface PipfileLockShape {
  default?: Record<string, PipfileLockEntry>;
  develop?: Record<string, PipfileLockEntry>;
}

function stripVersionOperator(version: string): string {
  return version.replace(/^==/, '');
}

/**
 * Parses `Pipfile.lock` (FR-3.4): both `default` and `develop` sections, each an exact
 * resolved version pinned with a leading `==` (Pipfile.lock's only supported operator for
 * a locked entry), stripped here since the fast path only needs the bare version.
 */
export function parsePipfileLock(content: string): LockfilePin[] {
  const doc = JSON.parse(content) as PipfileLockShape;
  const pins: LockfilePin[] = [];
  for (const section of [doc.default, doc.develop]) {
    for (const [name, entry] of Object.entries(section ?? {})) {
      if (entry.version) pins.push({ name, version: stripVersionOperator(entry.version) });
    }
  }
  return pins;
}
