// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { LockfilePin } from '../types.js';

interface NpmLockfileV1Entry {
  version?: string;
  dependencies?: Record<string, NpmLockfileV1Entry>;
}

interface NpmLockfileV1Shape {
  lockfileVersion?: number;
  dependencies?: Record<string, NpmLockfileV1Entry>;
}

interface NpmLockfileV2PackageEntry {
  version?: string;
}

interface NpmLockfileV2Shape {
  lockfileVersion?: number;
  packages?: Record<string, NpmLockfileV2PackageEntry>;
}

function nameFromPackagesKey(key: string): string | undefined {
  if (key === '') return undefined; // the root project itself, not a dependency
  const segments = key.split('node_modules/');
  const last = segments[segments.length - 1];
  return last || undefined;
}

function walkV1Dependencies(
  deps: Record<string, NpmLockfileV1Entry> | undefined,
  pins: LockfilePin[],
): void {
  for (const [name, entry] of Object.entries(deps ?? {})) {
    if (entry.version) pins.push({ name, version: entry.version });
    walkV1Dependencies(entry.dependencies, pins);
  }
}

/**
 * Parses `package-lock.json` (FR-3.4), covering both lockfile shapes: v2/v3's flat
 * `packages` map (keyed by path, e.g. `node_modules/express`) and v1's nested
 * `dependencies` tree (recursed for hoisted/nested duplicates). Every entry is an exact
 * resolved version — that's the whole fast-path premise, so specifiers/ranges never
 * enter into it.
 */
export function parseNpmLockfile(content: string): LockfilePin[] {
  const doc = JSON.parse(content) as NpmLockfileV1Shape & NpmLockfileV2Shape;
  const pins: LockfilePin[] = [];

  if (doc.packages) {
    for (const [key, entry] of Object.entries(doc.packages)) {
      const name = nameFromPackagesKey(key);
      if (name && entry.version) pins.push({ name, version: entry.version });
    }
    return pins;
  }

  walkV1Dependencies(doc.dependencies, pins);
  return pins;
}
