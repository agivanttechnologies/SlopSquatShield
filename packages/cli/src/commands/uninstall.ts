// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { defaultCacheDbPath } from '@slopsquatshield/core';
import { removeAntigravityHookConfig } from '../hooks/antigravity-config.js';
import { removeClaudeCodeHookConfig } from '../hooks/claude-code-config.js';
import { removeCodexHookConfig } from '../hooks/codex-config.js';
import { removeCursorHookConfig } from '../hooks/cursor-config.js';
import { gitHooksDir, removeGitHook } from '../hooks/git-hook.js';
import { launcherPath } from '../install/launcher.js';
import { detectDocumentsDir } from '../shell/documents-dir.js';
import { bashProfilePath, powerShellProfiles, zshProfilePath } from '../shell/profile-paths.js';
import { removeSnippetFromFile } from '../shell/snippet.js';
import { type WslHome, detectWslHome } from '../shell/wsl.js';

export interface UninstallOptions {
  /** Override for the home directory — tests must pass it; defaults to the real one. */
  home?: string;
  platform?: string;
  /** Report what would be removed without changing anything. */
  dryRun?: boolean;
  /** Also delete the local registry cache (never done otherwise: it holds no configuration). */
  purge?: boolean;
  /** Override for the registry cache location — tests must pass it with `purge`. */
  cachePath?: string;
  /** Override for WSL detection — tests must pass it so no real `wsl.exe` is spawned. */
  detectWslHome?: () => WslHome | undefined;
  /** Override for asking Windows where Documents is — tests must pass it so no real powershell.exe is spawned. */
  detectDocumentsDir?: () => string | undefined;
}

/**
 * `removed` — it was there and is gone (or, in a dry run, would be); `not-found` — nothing of ours
 * was there; `left-untouched` — it is there but could not be removed safely (a config file that
 * isn't valid JSON, which is never rewritten), so the person has to deal with it.
 */
export type UninstallOutcome = 'removed' | 'not-found' | 'left-untouched';

export interface UninstallAction {
  surface: string;
  /** The path it concerns. */
  location: string;
  outcome: UninstallOutcome;
  note?: string;
}

export interface UninstallResult {
  dryRun: boolean;
  actions: UninstallAction[];
  /** False when something was left untouched (the exit code is then 1). */
  ok: boolean;
}

const LEAVE_ALONE_NOTE = 'is not valid JSON, so it was left untouched — remove our entry by hand';

/**
 * The exact inverse of `init`: removes the shell-wrapper block from the bash/zsh/PowerShell
 * profiles, our hook entry from each agent host's config (user level and, when run from a project,
 * project level), our block from this repository's pre-commit hook, and the launcher directory
 * (which holds any CI shims). It touches **only what `init` wrote**: other content in a profile or
 * config is kept byte for byte, a pre-commit hook someone else chained after ours survives, and the
 * project's own `.slopsquatshield` / `.slopsquatshieldrc` are never deleted. `dryRun` lists everything
 * without changing anything. Every path is injectable so tests never reach real machine state.
 */
export function runUninstall(cwd: string, options: UninstallOptions = {}): UninstallResult {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const dryRun = options.dryRun ?? false;
  const inHome = resolve(cwd) === resolve(home);
  const wslHome = (options.detectWslHome ?? detectWslHome)();
  const actions: UninstallAction[] = [];

  const record = (
    surface: string,
    location: string,
    result: 'removed' | 'deleted' | 'absent' | 'invalid-json',
    note?: string,
  ): void => {
    const outcome: UninstallOutcome =
      result === 'absent' ? 'not-found' : result === 'invalid-json' ? 'left-untouched' : 'removed';
    actions.push({
      surface,
      location,
      outcome,
      note: result === 'invalid-json' ? LEAVE_ALONE_NOTE : note,
    });
  };

  // ---- shell wrapper (user profiles, and the WSL distro's when run from Windows) ----------------
  const profiles: Array<[string, string]> = [
    ['Shell wrapper (bash)', bashProfilePath(home)],
    ['Shell wrapper (zsh)', zshProfilePath(home)],
  ];
  // Where Windows says Documents is — plus the plain `<home>\Documents` an older init wrote to
  // when Documents was redirected (OneDrive). Same path twice is cleaned once.
  const documentsDir = (options.detectDocumentsDir ?? detectDocumentsDir)();
  const seen = new Set<string>();
  for (const dir of [documentsDir, undefined]) {
    for (const { label, path } of powerShellProfiles({ home, platform, documentsDir: dir })) {
      if (seen.has(path)) continue;
      seen.add(path);
      profiles.push([`Shell wrapper (${label})`, path]);
    }
  }
  if (wslHome) {
    profiles.push(
      [`Shell wrapper (${wslHome.distro} bash)`, bashProfilePath(wslHome.windowsPath)],
      [`Shell wrapper (${wslHome.distro} zsh)`, zshProfilePath(wslHome.windowsPath)],
    );
  }
  for (const [surface, path] of profiles) {
    record(surface, path, removeSnippetFromFile(path, dryRun));
  }

  // ---- agent hooks: user level, then project level (skipped when "here" is the home dir) ---------
  const roots: Array<[string, string]> = [['', home]];
  if (!inHome) roots.push([' (project)', cwd]);
  for (const [scope, root] of roots) {
    const project = scope !== '';
    record(
      `Claude Code hook${scope}`,
      join(root, '.claude', 'settings.json'),
      removeClaudeCodeHookConfig(root, dryRun),
    );
    record(
      `Cursor hook${scope}`,
      join(root, '.cursor', 'hooks.json'),
      removeCursorHookConfig(root, dryRun),
    );
    record(
      `Codex hook${scope}`,
      join(root, '.codex', 'hooks.json'),
      removeCodexHookConfig(root, dryRun),
    );
    record(
      `Antigravity hook${scope}`,
      project ? join(root, '.agents', 'hooks.json') : join(root, '.gemini', 'config', 'hooks.json'),
      removeAntigravityHookConfig(root, project ? 'project' : 'user', dryRun),
    );
  }
  if (wslHome) {
    record(
      `Claude Code hook (${wslHome.distro})`,
      join(wslHome.windowsPath, '.claude', 'settings.json'),
      removeClaudeCodeHookConfig(wslHome.windowsPath, dryRun),
    );
    record(
      `Codex hook (${wslHome.distro})`,
      join(wslHome.windowsPath, '.codex', 'hooks.json'),
      removeCodexHookConfig(wslHome.windowsPath, dryRun),
    );
  }

  // ---- this repository's pre-commit hook ---------------------------------------------------------
  const hooksDir = gitHooksDir(cwd);
  if (hooksDir) {
    const path = join(hooksDir, 'pre-commit');
    const result = removeGitHook(path, dryRun);
    record(
      'Git pre-commit hook',
      path,
      result,
      result === 'removed' ? 'our block removed; the rest of the hook is kept' : undefined,
    );
  }

  // ---- the launcher directory (also holds any CI shims) ------------------------------------------
  const launcherDirs: Array<[string, string]> = [
    ['Launcher and CI shims', dirname(dirname(launcherPath(home, platform)))],
  ];
  if (wslHome) {
    launcherDirs.push([
      `Launcher (${wslHome.distro})`,
      join(wslHome.windowsPath, '.config', 'slopsquatshield'),
    ]);
  }
  for (const [surface, dir] of launcherDirs) {
    // Only ever a directory we own: refuse to recursively delete anything not named for us.
    if (basename(dir) !== 'slopsquatshield' || !existsSync(dir)) {
      record(surface, dir, 'absent');
      continue;
    }
    if (!dryRun) rmSync(dir, { recursive: true, force: true });
    record(surface, dir, 'removed');
  }

  // ---- the registry cache, only on request --------------------------------------------------------
  if (options.purge) {
    const cacheDir = dirname(options.cachePath ?? defaultCacheDbPath());
    if (basename(cacheDir) === 'slopsquatshield-nodejs' && existsSync(cacheDir)) {
      if (!dryRun) rmSync(cacheDir, { recursive: true, force: true });
      record('Registry cache', cacheDir, 'removed');
    } else {
      record('Registry cache', cacheDir, 'absent');
    }
  }

  return { dryRun, actions, ok: actions.every((a) => a.outcome !== 'left-untouched') };
}
