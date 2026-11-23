// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type HookHost, isOurHookCommand } from './hook-command.js';

/**
 * `hooks.PreToolUse[] → { matcher, hooks: [{ type, command }] }` is the shape Claude Code's
 * `settings.json` and Codex's `hooks.json` share, so one reader/writer serves both. Cursor
 * and Antigravity have different shapes and keep their own.
 */
interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}
interface MatcherGroup {
  matcher: string;
  hooks?: HookEntry[];
}
interface MatcherGroupFile {
  hooks?: { PreToolUse?: MatcherGroup[] };
  [key: string]: unknown;
}

/** `current`: our hook with today's command · `outdated`: ours, but a legacy command form. */
export type HookState = 'current' | 'outdated' | 'absent' | 'invalid-json';
export type HookWriteResult = 'installed' | 'already-installed' | 'upgraded' | 'invalid-json';
/** `invalid-json`: the file isn't valid JSON, so it was left untouched and our entry may still be in it. */
export type HookRemoveResult = 'removed' | 'absent' | 'invalid-json';

export interface MatcherGroupHookSpec {
  host: HookHost;
  command: string;
  /** Tool matcher the group applies to — `Bash` for Claude Code and Codex. */
  matcher: string;
  /** Seconds. Codex defaults to 600s, far too long for a blocking hook, so it sets one. */
  timeout?: number;
}

function readFile(path: string): MatcherGroupFile | 'invalid-json' | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as MatcherGroupFile;
  } catch {
    return 'invalid-json';
  }
}

function ourEntries(file: MatcherGroupFile, host: HookHost): HookEntry[] {
  return (file.hooks?.PreToolUse ?? [])
    .flatMap((group) => group.hooks ?? [])
    .filter((hook) => isOurHookCommand(hook.command, host));
}

/**
 * Removes our hook entries from `path` and prunes only what that leaves empty (a matcher group, a
 * `PreToolUse` list, a `hooks` object) — everything else in the file, including other hooks in the
 * same group, is kept. An unparseable file is never rewritten. `dryRun` reports without writing.
 */
export function removeMatcherGroupHook(
  path: string,
  host: HookHost,
  dryRun = false,
): HookRemoveResult {
  const file = readFile(path);
  if (file === 'invalid-json') return 'invalid-json';
  if (!file || ourEntries(file, host).length === 0) return 'absent';
  if (dryRun) return 'removed';

  const groups: MatcherGroup[] = [];
  for (const group of file.hooks?.PreToolUse ?? []) {
    const before = group.hooks ?? [];
    const after = before.filter((hook) => !isOurHookCommand(hook.command, host));
    if (after.length === before.length)
      groups.push(group); // not ours: untouched
    else if (after.length > 0) groups.push({ ...group, hooks: after });
    // else: the group held only our hook — drop it
  }
  if (file.hooks) {
    if (groups.length > 0) file.hooks.PreToolUse = groups;
    else file.hooks.PreToolUse = undefined;
    if (Object.values(file.hooks).every((v) => v === undefined)) file.hooks = undefined;
  }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  return 'removed';
}

export function matcherGroupHookState(path: string, spec: MatcherGroupHookSpec): HookState {
  const file = readFile(path);
  if (file === 'invalid-json') return 'invalid-json';
  if (!file) return 'absent';
  const entries = ourEntries(file, spec.host);
  if (entries.length === 0) return 'absent';
  return entries.some((e) => e.command === spec.command && e.timeout === spec.timeout)
    ? 'current'
    : 'outdated';
}

/**
 * Writes (or merges into) the file at `path` a PreToolUse hook for `spec.matcher` running
 * `spec.command`. Idempotent; a legacy entry for our hook is rewritten in place (`upgraded`)
 * rather than duplicated. An unparseable file is left untouched and reported as
 * `invalid-json` — never overwritten with `{}`.
 */
export function writeMatcherGroupHook(path: string, spec: MatcherGroupHookSpec): HookWriteResult {
  const file = readFile(path);
  if (file === 'invalid-json') return 'invalid-json';

  const next: MatcherGroupFile = file ?? {};
  const preToolUse = next.hooks?.PreToolUse ?? [];
  const entry = (): HookEntry => ({
    type: 'command',
    command: spec.command,
    ...(spec.timeout === undefined ? {} : { timeout: spec.timeout }),
  });

  const existing = ourEntries(next, spec.host);
  if (existing.length > 0) {
    if (existing.every((e) => e.command === spec.command && e.timeout === spec.timeout)) {
      return 'already-installed';
    }
    for (const e of existing) {
      e.command = spec.command;
      if (spec.timeout === undefined) e.timeout = undefined;
      else e.timeout = spec.timeout;
    }
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    return 'upgraded';
  }

  const group = preToolUse.find((g) => g.matcher === spec.matcher);
  if (group) {
    group.hooks = [...(group.hooks ?? []), entry()];
  } else {
    preToolUse.push({ matcher: spec.matcher, hooks: [entry()] });
  }
  next.hooks = { ...next.hooks, PreToolUse: preToolUse };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return 'installed';
}
