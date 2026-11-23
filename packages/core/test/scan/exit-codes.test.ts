// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { computeExitCode } from '../../src/scan/exit-codes.js';

const v = (tier: 'BLOCK' | 'WARN' | 'CLEAN') => ({ tier });

describe('computeExitCode', () => {
  it.each([
    ['nothing at all', [], 0, 0, 0],
    ['only clean verdicts', [v('CLEAN')], 0, 0, 0],
    ['a WARN', [v('WARN'), v('CLEAN')], 0, 0, 1],
    ['a BLOCK', [v('BLOCK'), v('CLEAN')], 0, 0, 2],
    ['a registry that never answered', [v('CLEAN')], 1, 0, 3],
    ['a manifest that could not be parsed', [], 0, 1, 3],
    ['both of those', [v('CLEAN')], 1, 2, 3],
    ['a WARN beats an unreachable registry', [v('WARN')], 1, 0, 1],
    ['a WARN beats an unparseable manifest', [v('WARN')], 0, 1, 1],
    ['a BLOCK beats everything', [v('BLOCK'), v('WARN')], 2, 3, 2],
  ] as const)('%s', (_name, verdicts, unreachableCount, manifestErrorCount, expected) => {
    expect(computeExitCode({ verdicts, unreachableCount, manifestErrorCount })).toBe(expected);
  });

  it('treats a missing manifestErrorCount as zero (the old two-argument behaviour)', () => {
    expect(computeExitCode({ verdicts: [v('CLEAN')], unreachableCount: 0 })).toBe(0);
  });
});
