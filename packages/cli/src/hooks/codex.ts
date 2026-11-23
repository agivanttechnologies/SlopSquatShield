// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';

/**
 * Formats a host-neutral `HookCheckResult` for Codex CLI (FR-12.3/12.5). Codex's PreToolUse
 * contract is Claude Code-shaped for a deny, but **`ask` is unsupported** — Codex marks the
 * hook run failed and continues the tool call — so this adapter is deny-only:
 *   BLOCK → the `permissionDecision: "deny"` JSON body;
 *   WARN / allow → empty stdout (Codex treats exit 0 with no output as success).
 * A WARN's reason goes to stderr instead of being dropped (NFR-6.1: no unexplained verdicts),
 * though Codex may not surface it. Callers always exit 0.
 */
export function formatCodexHookOutput(result: HookCheckResult): { stdout: string; stderr: string } {
  if (result.decision === 'deny') {
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      }),
      stderr: '',
    };
  }
  return {
    stdout: '',
    // The reason already starts with "SlopSquatShield: …", so it needs no prefix of its own.
    stderr: result.decision === 'ask' ? result.reason : '',
  };
}
