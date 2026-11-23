// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path';
import { codexHookCommand } from './hook-command.js';
import {
  type HookRemoveResult,
  type HookState,
  type HookWriteResult,
  type MatcherGroupHookSpec,
  matcherGroupHookState,
  removeMatcherGroupHook,
  writeMatcherGroupHook,
} from './matcher-group-config.js';

/** Seconds — Codex's own default is 600, which would let a hung registry call stall the agent. */
export const CODEX_HOOK_TIMEOUT_SECONDS = 30;

/**
 * `root` is the directory containing `.codex/` — the user's home (`~/.codex/hooks.json`) or a
 * project dir. Codex loads a project-local `.codex/hooks.json` only when that project is
 * trusted, and hooks written inline in `config.toml` are not seen here (known limits).
 */
export function codexHooksConfigPath(root: string): string {
  return join(root, '.codex', 'hooks.json');
}

function spec(home?: string, platform?: string, command?: string): MatcherGroupHookSpec {
  return {
    host: 'codex',
    // `command` overrides the derived launcher path (a WSL distro's POSIX home).
    command: command ?? codexHookCommand(home, platform),
    // `Bash` matches both shell commands and `exec_command` in Codex.
    matcher: 'Bash',
    timeout: CODEX_HOOK_TIMEOUT_SECONDS,
  };
}

export function codexHookState(
  root: string,
  home?: string,
  platform?: string,
  command?: string,
): HookState {
  return matcherGroupHookState(codexHooksConfigPath(root), spec(home, platform, command));
}

export function hasCodexHook(
  root: string,
  home?: string,
  platform?: string,
  command?: string,
): boolean {
  return codexHookState(root, home, platform, command) === 'current';
}

export function removeCodexHookConfig(root: string, dryRun = false): HookRemoveResult {
  return removeMatcherGroupHook(codexHooksConfigPath(root), 'codex', dryRun);
}

export function writeCodexHookConfig(
  root: string,
  home?: string,
  platform?: string,
  command?: string,
): HookWriteResult {
  return writeMatcherGroupHook(codexHooksConfigPath(root), spec(home, platform, command));
}
