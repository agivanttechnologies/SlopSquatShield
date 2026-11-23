// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import { formatAntigravityHookOutput } from '../../src/hooks/antigravity.js';

const result = (decision: HookCheckResult['decision'], reason: string): HookCheckResult => ({
  decision,
  reason,
  verdicts: [],
  unreachable: [],
});

describe('formatAntigravityHookOutput', () => {
  it.each(['deny', 'ask'] as const)(
    'puts %s in a top-level decision field, with the reason',
    (decision) => {
      expect(JSON.parse(formatAntigravityHookOutput(result(decision, 'because')))).toEqual({
        decision,
        reason: 'because',
      });
    },
  );

  it("prints nothing for allow, so it can never override the user's own approval settings", () => {
    expect(formatAntigravityHookOutput(result('allow', 'fine'))).toBe('');
  });

  it('keeps WARN as ask (Antigravity supports it, unlike Codex)', () => {
    expect(JSON.parse(formatAntigravityHookOutput(result('ask', 'w'))).decision).toBe('ask');
  });
});
