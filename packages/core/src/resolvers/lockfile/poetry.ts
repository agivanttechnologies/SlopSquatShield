// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { parse as parseToml } from 'smol-toml';
import type { LockfilePin } from '../types.js';

interface PoetryLockPackage {
  name?: string;
  version?: string;
}

interface PoetryLockShape {
  package?: PoetryLockPackage[];
}

/** Parses `poetry.lock` (FR-3.4): each `[[package]]` table is one exact resolved version. */
export function parsePoetryLock(content: string): LockfilePin[] {
  const doc = parseToml(content) as PoetryLockShape;
  const pins: LockfilePin[] = [];
  for (const pkg of doc.package ?? []) {
    if (pkg.name && pkg.version) pins.push({ name: pkg.name, version: pkg.version });
  }
  return pins;
}
