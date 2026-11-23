// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendToAllowlist, parseAllowlist } from '@slopsquatshield/core';

export type AllowResult = 'added' | 'already-present';

/**
 * `slopsquatshield allow <identifier>` (FR-5.3): appends to `<cwd>/.slopsquatshield`, creating
 * the file if absent. Idempotent — an identifier already listed is left alone. The string
 * transform itself is core's `appendToAllowlist`; this is just the file I/O around it, which
 * the editor extension's "add to allowlist" quick-fix reuses the same transform for.
 */
export function runAllow(cwd: string, identifier: string): AllowResult {
  const trimmed = identifier.trim();
  if (!trimmed || /[\s#]/.test(trimmed)) {
    throw new Error(
      `"${identifier}" is not a valid allowlist identifier — use a bare package name, or groupId:artifactId for Maven`,
    );
  }

  const path = join(cwd, '.slopsquatshield');
  const current = existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
  if (current !== undefined && parseAllowlist(current).has(trimmed)) return 'already-present';

  writeFileSync(path, appendToAllowlist(current, trimmed));
  return 'added';
}
