// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';

/** Who is really on the other end of a `hook claude-code` call (see `parseHookInput`). */
export interface ClaudeCodeFormatOptions {
  /**
   * Cursor imports hooks from `~/.claude/settings.json` and runs them with its own payload. It
   * accepts Claude Code's nested `hookSpecificOutput` shape, but an empty reply to a permission
   * hook is not documented as "no opinion" there, so a Cursor caller always gets an explicit body.
   */
  caller?: 'cursor';
}

/**
 * Formats a host-neutral `HookCheckResult` into Claude Code's PreToolUse stdout schema
 * (FR-12.4) — the only host-specific part of
 * the whole hook path; every bit of actual detection logic already happened in
 * `runHookCheckFromStdin()`/core's `runHookCheck()`. Claude Code communicates its decision
 * *in* this JSON body, not via process exit code, so callers should always exit 0.
 *
 * `allow` prints **nothing**. In Claude Code a PreToolUse `"allow"` skips the user's permission
 * prompt, whereas exit 0 with no output "continues through the normal permission flow"
 * (code.claude.com/docs/en/hooks). A guard must only ever narrow what the agent may do, so
 * "I found nothing wrong" must not become "approved".
 */
export function formatClaudeCodeHookOutput(
  result: HookCheckResult,
  options: ClaudeCodeFormatOptions = {},
): string {
  if (result.decision === 'allow' && options.caller !== 'cursor') return '';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
      permissionDecisionReason: result.reason,
    },
  });
}
