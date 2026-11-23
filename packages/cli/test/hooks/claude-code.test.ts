// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import { formatClaudeCodeHookOutput } from '../../src/hooks/claude-code.js';

describe('formatClaudeCodeHookOutput', () => {
  it("matches FR-12.4's deny example shape", () => {
    const result: HookCheckResult = {
      decision: 'deny',
      reason: 'Package does not exist on npm.',
      verdicts: [],
      unreachable: [],
    };

    expect(JSON.parse(formatClaudeCodeHookOutput(result))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Package does not exist on npm.',
      },
    });
  });

  it('prints nothing for allow, so Claude Code keeps its normal permission prompt', () => {
    const result: HookCheckResult = {
      decision: 'allow',
      reason: 'not a recognized install command',
      verdicts: [],
      unreachable: [],
    };

    // An explicit "allow" would skip the user's own approval; silence does not (#26).
    expect(formatClaudeCodeHookOutput(result)).toBe('');
  });

  it('answers a Cursor caller (imported ~/.claude hook) with an explicit allow body', () => {
    const result: HookCheckResult = {
      decision: 'allow',
      reason: 'ls — not an install',
      verdicts: [],
      unreachable: [],
    };

    expect(
      JSON.parse(formatClaudeCodeHookOutput(result, { caller: 'cursor' })).hookSpecificOutput
        .permissionDecision,
    ).toBe('allow');
  });

  it('formats an ask decision', () => {
    const result: HookCheckResult = {
      decision: 'ask',
      reason: 'published 2.0 day(s) ago (< 14-day threshold)',
      verdicts: [],
      unreachable: [],
    };

    expect(
      JSON.parse(formatClaudeCodeHookOutput(result)).hookSpecificOutput.permissionDecision,
    ).toBe('ask');
  });
});
