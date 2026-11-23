// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cursorHookCommand, isOurHookCommand } from './hook-command.js';
import type { HookRemoveResult, HookState, HookWriteResult } from './matcher-group-config.js';

interface CursorHookEntry {
  command: string;
}
interface CursorSettings {
  version?: number;
  hooks?: { beforeShellExecution?: CursorHookEntry[] };
  [key: string]: unknown;
}

/** `root` is the directory containing `.cursor/` — project dir, or the user's home. */
export function cursorHooksConfigPath(root: string): string {
  return join(root, '.cursor', 'hooks.json');
}

function readSettings(path: string): CursorSettings | 'invalid-json' | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CursorSettings;
  } catch {
    return 'invalid-json';
  }
}

function ourEntries(settings: CursorSettings): CursorHookEntry[] {
  return (settings.hooks?.beforeShellExecution ?? []).filter((hook) =>
    isOurHookCommand(hook.command, 'cursor'),
  );
}

export function cursorHookState(root: string, home?: string, platform?: string): HookState {
  const settings = readSettings(cursorHooksConfigPath(root));
  if (settings === 'invalid-json') return 'invalid-json';
  if (!settings) return 'absent';
  const entries = ourEntries(settings);
  if (entries.length === 0) return 'absent';
  const command = cursorHookCommand(home, platform);
  return entries.some((e) => e.command === command) ? 'current' : 'outdated';
}

/** Removes our entries from `<root>/.cursor/hooks.json`, keeping `version` and anything else. */
export function removeCursorHookConfig(root: string, dryRun = false): HookRemoveResult {
  const path = cursorHooksConfigPath(root);
  const settings = readSettings(path);
  if (settings === 'invalid-json') return 'invalid-json';
  if (!settings || ourEntries(settings).length === 0) return 'absent';
  if (dryRun) return 'removed';

  const kept = (settings.hooks?.beforeShellExecution ?? []).filter(
    (hook) => !isOurHookCommand(hook.command, 'cursor'),
  );
  if (settings.hooks) {
    settings.hooks.beforeShellExecution = kept.length > 0 ? kept : undefined;
    if (Object.values(settings.hooks).every((v) => v === undefined)) settings.hooks = undefined;
  }
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return 'removed';
}

export function hasCursorHook(root: string, home?: string, platform?: string): boolean {
  return cursorHookState(root, home, platform) === 'current';
}

/**
 * Writes (or merges into) `<root>/.cursor/hooks.json` a beforeShellExecution hook running
 * the launcher's `hook cursor` (FR-12.2/12.4). Same contract as the Claude Code writer:
 * idempotent, legacy entries upgraded in place, unparseable files never overwritten.
 */
export function writeCursorHookConfig(
  root: string,
  home?: string,
  platform?: string,
): HookWriteResult {
  const path = cursorHooksConfigPath(root);
  const settings = readSettings(path);
  if (settings === 'invalid-json') return 'invalid-json';

  const command = cursorHookCommand(home, platform);
  const next: CursorSettings = settings ?? { version: 1 };

  const existing = ourEntries(next);
  if (existing.length > 0) {
    if (existing.every((e) => e.command === command)) return 'already-installed';
    for (const entry of existing) entry.command = command;
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    return 'upgraded';
  }

  const beforeShellExecution = next.hooks?.beforeShellExecution ?? [];
  beforeShellExecution.push({ command });
  next.hooks = { ...next.hooks, beforeShellExecution };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return 'installed';
}
