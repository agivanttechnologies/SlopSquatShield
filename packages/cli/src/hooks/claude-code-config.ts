// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path';
import { claudeCodeHookCommand } from './hook-command.js';
import {
  type HookRemoveResult,
  type HookState,
  type HookWriteResult,
  type MatcherGroupHookSpec,
  matcherGroupHookState,
  removeMatcherGroupHook,
  writeMatcherGroupHook,
} from './matcher-group-config.js';

export type { HookRemoveResult, HookState, HookWriteResult };

/**
 * `root` is the directory *containing* `.claude/` — the project dir for project scope, or
 * the user's home for user scope (`~/.claude/settings.json`).
 */
export function claudeCodeSettingsPath(root: string): string {
  return join(root, '.claude', 'settings.json');
}

function spec(): MatcherGroupHookSpec {
  return { host: 'claude-code', command: claudeCodeHookCommand(), matcher: 'Bash' };
}

export function claudeCodeHookState(root: string): HookState {
  return matcherGroupHookState(claudeCodeSettingsPath(root), spec());
}

/** True when `<root>/.claude/settings.json` has our hook in its current form. */
export function hasClaudeCodeHook(root: string): boolean {
  return claudeCodeHookState(root) === 'current';
}

/**
 * Writes (or merges into) `<root>/.claude/settings.json` a PreToolUse hook on the Bash tool
 * running the launcher's `hook claude-code` (FR-12.1/12.4). See `matcher-group-config.ts` for
 * the idempotence / upgrade-in-place / invalid-JSON contract.
 */
export function removeClaudeCodeHookConfig(root: string, dryRun = false): HookRemoveResult {
  return removeMatcherGroupHook(claudeCodeSettingsPath(root), 'claude-code', dryRun);
}

export function writeClaudeCodeHookConfig(root: string): HookWriteResult {
  return writeMatcherGroupHook(claudeCodeSettingsPath(root), spec());
}
