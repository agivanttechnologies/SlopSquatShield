// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import { formatCursorHookOutput } from '../../src/hooks/cursor.js';

const result = (decision: HookCheckResult['decision'], reason: string): HookCheckResult => ({
  decision,
  reason,
  verdicts: [],
  unreachable: [],
});

describe('formatCursorHookOutput', () => {
  it("uses Cursor's documented flat schema: permission + user_message + agent_message", () => {
    expect(
      JSON.parse(formatCursorHookOutput(result('deny', 'Package does not exist on npm.'))),
    ).toEqual({
      permission: 'deny',
      user_message: 'Package does not exist on npm.',
      agent_message: 'Package does not exist on npm.',
    });
  });

  it('does not use the Claude Code hookSpecificOutput shape', () => {
    expect(formatCursorHookOutput(result('deny', 'x'))).not.toContain('hookSpecificOutput');
  });

  it('formats an ask decision', () => {
    expect(
      JSON.parse(formatCursorHookOutput(result('ask', 'no repository link declared'))).permission,
    ).toBe('ask');
  });

  it('sends allow explicitly: Cursor blocks on an empty or mismatched reply', () => {
    expect(JSON.parse(formatCursorHookOutput(result('allow', 'ls — no findings')))).toEqual({
      permission: 'allow',
      user_message: 'ls — no findings',
      agent_message: 'ls — no findings',
    });
  });
});
