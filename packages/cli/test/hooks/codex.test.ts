// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import { formatCodexHookOutput } from '../../src/hooks/codex.js';

const base = { verdicts: [], unreachable: [] } as const;
const result = (decision: HookCheckResult['decision'], reason = 'r'): HookCheckResult => ({
  ...base,
  decision,
  reason,
});

describe('formatCodexHookOutput (FR-12.3/12.5: deny-only)', () => {
  it('BLOCK → the permissionDecision "deny" body', () => {
    const out = formatCodexHookOutput(result('deny', 'BLOCK: x does not exist'));
    expect(JSON.parse(out.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'BLOCK: x does not exist',
      },
    });
    expect(out.stderr).toBe('');
  });

  it('allow → empty stdout (Codex treats exit 0 with no output as success)', () => {
    expect(formatCodexHookOutput(result('allow'))).toEqual({ stdout: '', stderr: '' });
  });

  it('WARN (ask) collapses to allow: empty stdout, never an "ask" body, reason kept on stderr', () => {
    const reason =
      "SlopSquatShield: 1 package in this command looks risky, so it needs the user's confirmation.";
    const out = formatCodexHookOutput(result('ask', reason));
    expect(out.stdout).toBe('');
    expect(out.stdout).not.toContain('ask');
    // The reason already names the tool; it is passed through as it is, not prefixed again.
    expect(out.stderr).toBe(reason);
  });
});
