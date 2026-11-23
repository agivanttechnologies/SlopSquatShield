// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { describeVerdict } from '../../src/rules/describe.js';
import type { Verdict } from '../../src/rules/types.js';

const ghost: Verdict = {
  identifier: 'zz-ghost',
  ecosystem: 'npm',
  tier: 'BLOCK',
  signals: [{ type: 'non-existence', reason: 'Does not exist on the npm registry.' }],
  reason: 'Does not exist on the npm registry.',
};

describe('describeVerdict', () => {
  it('names the package and its ecosystem before the reason', () => {
    expect(describeVerdict(ghost)).toBe('zz-ghost (npm): Does not exist on the npm registry.');
  });

  it('says which manifest declared it when an install read it from one', () => {
    expect(describeVerdict({ ...ghost, declaredIn: 'package.json' })).toBe(
      'zz-ghost (npm, declared in package.json): Does not exist on the npm registry.',
    );
  });
});
