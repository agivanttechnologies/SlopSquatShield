// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Verdict } from './types.js';

/**
 * One verdict as a self-contained line: `name (ecosystem): reason`, plus where it was declared when
 * an install read it from a manifest — `zz-ghost (npm, declared in package.json): Does not exist on
 * the npm registry.` For any surface that shows a verdict without its own name column: the install
 * wrapper, the agent hooks, an editor's Problems list.
 */
export function describeVerdict(verdict: Verdict): string {
  const where = verdict.declaredIn ? `, declared in ${verdict.declaredIn}` : '';
  return `${verdict.identifier} (${verdict.ecosystem}${where}): ${verdict.reason}`;
}
