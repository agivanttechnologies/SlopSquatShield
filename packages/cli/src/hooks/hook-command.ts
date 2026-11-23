// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { homedir } from 'node:os';
import { launcherPath } from '../install/launcher.js';

export type HookHost = 'claude-code' | 'cursor' | 'codex' | 'antigravity';

/**
 * Claude Code runs hook commands through a shell, so `$HOME` expands and the settings file
 * stays portable. (Native-Windows Claude Code is assumed to use Git Bash for this — not yet
 * verified on a real Windows install.)
 */
export function claudeCodeHookCommand(): string {
  return '"$HOME/.config/slopsquatshield/bin/slopsquatshield" hook claude-code';
}

/**
 * The expanded, quoted absolute launcher path — used for hosts whose hook shell is
 * undocumented or may not expand `$HOME` (Cursor, Codex, Antigravity).
 */
export function absoluteHookCommand(
  host: Exclude<HookHost, 'claude-code'>,
  home: string = homedir(),
  platform: string = process.platform,
): string {
  return `"${launcherPath(home, platform)}" hook ${host}`;
}

/**
 * The launcher command for a POSIX home reached from a Windows host (a WSL distro's home).
 * Built by hand with forward slashes — `path.join` on Windows would produce backslashes.
 */
export function wslHookCommand(host: Exclude<HookHost, 'claude-code'>, posixHome: string): string {
  return `"${posixHome}/.config/slopsquatshield/bin/slopsquatshield" hook ${host}`;
}

export function cursorHookCommand(home?: string, platform?: string): string {
  return absoluteHookCommand('cursor', home, platform);
}

export function codexHookCommand(home?: string, platform?: string): string {
  return absoluteHookCommand('codex', home, platform);
}

export function antigravityHookCommand(home?: string, platform?: string): string {
  return absoluteHookCommand('antigravity', home, platform);
}

/**
 * True for any command that runs our hook for `host` — the current launcher form, a legacy
 * bare `slopsquatshield hook <host>`, or a hand-written absolute path (the nvm
 * workaround). Recognising all of them lets `init` upgrade an old entry in place rather
 * than appending a duplicate beside it.
 */
export function isOurHookCommand(command: unknown, host: HookHost): boolean {
  if (typeof command !== 'string') return false;
  const pattern = new RegExp(
    `(^|[\\s"'/\\\\])slopsquatshield(\\.cmd|\\.ps1)?["']?\\s+hook\\s+${host}\\s*$`,
  );
  return pattern.test(command.trim());
}
