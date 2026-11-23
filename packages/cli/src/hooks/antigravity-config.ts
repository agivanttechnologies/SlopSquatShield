// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { antigravityHookCommand, isOurHookCommand } from './hook-command.js';
import type { HookRemoveResult, HookState, HookWriteResult } from './matcher-group-config.js';

/** Seconds — Antigravity's own default is 30; stated explicitly so it never silently changes. */
export const ANTIGRAVITY_HOOK_TIMEOUT_SECONDS = 30;
/** The shell-execution tool Antigravity's PreToolUse matcher targets. */
export const ANTIGRAVITY_SHELL_TOOL = 'run_command';
/** The named-hook key we own inside `hooks.json`. */
const HOOK_NAME = 'slopsquatshield';

export type AntigravityScope = 'user' | 'project';

interface HandlerEntry {
  type?: string;
  command: string;
  timeout?: number;
}
interface MatcherEntry {
  matcher: string;
  hooks?: HandlerEntry[];
}
interface NamedHook {
  enabled?: boolean;
  PreToolUse?: MatcherEntry[];
  [event: string]: unknown;
}
type AntigravityHooksFile = Record<string, NamedHook>;

/**
 * Antigravity's `hooks.json` is a map of *named* hooks, each mapping events to matcher
 * arrays — no top-level `hooks` key, unlike Claude Code/Codex. User scope lives at
 * `~/.gemini/config/hooks.json`, project scope at `<project>/.agents/hooks.json`.
 * (Precedence between them, and the CLI's extra `~/.gemini/antigravity-cli/settings.json`
 * location, are undocumented — known limits.)
 */
export function antigravityHooksConfigPath(root: string, scope: AntigravityScope): string {
  return scope === 'user'
    ? join(root, '.gemini', 'config', 'hooks.json')
    : join(root, '.agents', 'hooks.json');
}

function readFile(path: string): AntigravityHooksFile | 'invalid-json' | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as AntigravityHooksFile) : {};
  } catch {
    return 'invalid-json';
  }
}

function ourEntries(file: AntigravityHooksFile): HandlerEntry[] {
  return Object.values(file).flatMap((named) =>
    (named?.PreToolUse ?? [])
      .flatMap((m) => m.hooks ?? [])
      .filter((h) => isOurHookCommand(h.command, 'antigravity')),
  );
}

/**
 * Removes our entries from Antigravity's `hooks.json`, wherever they are among its named hooks, and
 * prunes only what that leaves empty. Our own named hook (`slopsquatshield`) is deleted once nothing
 * but its `enabled` flag is left; any other named hook is left exactly as it was.
 */
export function removeAntigravityHookConfig(
  root: string,
  scope: AntigravityScope,
  dryRun = false,
): HookRemoveResult {
  const path = antigravityHooksConfigPath(root, scope);
  const file = readFile(path);
  if (file === 'invalid-json') return 'invalid-json';
  if (!file || ourEntries(file).length === 0) return 'absent';
  if (dryRun) return 'removed';

  for (const [name, named] of Object.entries(file)) {
    if (!named?.PreToolUse) continue;
    const matchers: MatcherEntry[] = [];
    for (const matcher of named.PreToolUse) {
      const before = matcher.hooks ?? [];
      const after = before.filter((h) => !isOurHookCommand(h.command, 'antigravity'));
      if (after.length === before.length) matchers.push(matcher);
      else if (after.length > 0) matchers.push({ ...matcher, hooks: after });
    }
    named.PreToolUse = matchers.length > 0 ? matchers : undefined;
    const onlyFlagsLeft = Object.keys(named).every(
      (k) => k === 'enabled' || named[k] === undefined,
    );
    if (name === HOOK_NAME && onlyFlagsLeft) delete file[name];
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return 'removed';
}

export function antigravityHookState(
  root: string,
  scope: AntigravityScope,
  home?: string,
  platform?: string,
): HookState {
  const file = readFile(antigravityHooksConfigPath(root, scope));
  if (file === 'invalid-json') return 'invalid-json';
  if (!file) return 'absent';
  const entries = ourEntries(file);
  if (entries.length === 0) return 'absent';
  const command = antigravityHookCommand(home, platform);
  return entries.some(
    (e) => e.command === command && e.timeout === ANTIGRAVITY_HOOK_TIMEOUT_SECONDS,
  )
    ? 'current'
    : 'outdated';
}

export function writeAntigravityHookConfig(
  root: string,
  scope: AntigravityScope,
  home?: string,
  platform?: string,
): HookWriteResult {
  const path = antigravityHooksConfigPath(root, scope);
  const file = readFile(path);
  if (file === 'invalid-json') return 'invalid-json';

  const command = antigravityHookCommand(home, platform);
  const next: AntigravityHooksFile = file ?? {};
  const timeout = ANTIGRAVITY_HOOK_TIMEOUT_SECONDS;

  const existing = ourEntries(next);
  if (existing.length > 0) {
    if (existing.every((e) => e.command === command && e.timeout === timeout)) {
      return 'already-installed';
    }
    for (const e of existing) {
      e.command = command;
      e.timeout = timeout;
    }
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    return 'upgraded';
  }

  const named: NamedHook = next[HOOK_NAME] ?? {};
  next[HOOK_NAME] = named;
  const preToolUse: MatcherEntry[] = named.PreToolUse ?? [];
  named.PreToolUse = preToolUse;
  const handler: HandlerEntry = { type: 'command', command, timeout };
  const group = preToolUse.find((m) => m.matcher === ANTIGRAVITY_SHELL_TOOL);
  if (group) group.hooks = [...(group.hooks ?? []), handler];
  else preToolUse.push({ matcher: ANTIGRAVITY_SHELL_TOOL, hooks: [handler] });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return 'installed';
}
