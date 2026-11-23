// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';

/**
 * Formats a host-neutral `HookCheckResult` for Google Antigravity (FR-12.4/12.5).
 * Antigravity's PreToolUse contract is its own, not Claude Code's: the decision goes in a
 * top-level `decision` field with an optional `reason`. It does support `ask`, so WARN keeps
 * its human-confirmation semantics (unlike Codex). The docs don't specify exit-code
 * behaviour, so callers always exit 0 and rely on this body.
 *
 * `allow` prints nothing: the runtime treats an empty or unrecognised reply as approval
 * anyway, and an explicit `allow` risks being read as overriding the user's own approval
 * settings — a guard should only ever narrow what the agent may do.
 */
export function formatAntigravityHookOutput(result: HookCheckResult): string {
  if (result.decision === 'allow') return '';
  return JSON.stringify({ decision: result.decision, reason: result.reason });
}
