// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookCheckResult } from '@slopsquatshield/core';

/**
 * Formats a host-neutral `HookCheckResult` into Cursor's `beforeShellExecution` response.
 * Cursor's documented contract (cursor.com/docs/hooks) is a flat, snake_case object:
 * `{ permission: "allow" | "deny" | "ask", user_message, agent_message }`. (An earlier version
 * of this adapter sent Claude Code's nested `hookSpecificOutput` shape, which Cursor only
 * understands for hooks it imports from `.claude/settings.json`.) Cursor treats an invalid or
 * schema-mismatched reply to a permission hook as a block, so `allow` is sent explicitly
 * rather than as empty output.
 *
 * `user_message` is what the person sees — one short line naming what was flagged — and
 * `agent_message` is what the agent is told: the full reason, one package per line, with what to
 * do instead, so a denied agent learns why and does not just retry.
 */
export function formatCursorHookOutput(result: HookCheckResult): string {
  return JSON.stringify({
    permission: result.decision,
    user_message: result.summary ?? result.reason,
    agent_message: result.reason,
  });
}
