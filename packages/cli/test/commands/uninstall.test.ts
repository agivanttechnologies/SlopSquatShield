// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../../src/commands/init.js';
import { runUninstall } from '../../src/commands/uninstall.js';
import {
  bashProfilePath,
  powerShellProfiles,
  zshProfilePath,
} from '../../src/shell/profile-paths.js';

let home: string;
let project: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ssg-uninstall-home-'));
  project = mkdtempSync(join(tmpdir(), 'ssg-uninstall-project-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

// Same discipline as the other command tests: every path is passed explicitly, so nothing here can
// reach the real home directory, and no real wsl.exe is ever spawned.
const noDocumentsDir = () => undefined; // never spawn a real powershell.exe
const noWsl = () => undefined;
const location = { nodePath: '/fake/node', entryPath: '/fake/dist/index.js', ephemeral: false };
const initOpts = () => ({
  home,
  selfLocation: location,
  detectWslHome: noWsl,
  detectDocumentsDir: noDocumentsDir,
  platform: 'linux',
});
const uninstallOpts = (extra: object = {}) => ({
  home,
  detectWslHome: noWsl,
  detectDocumentsDir: noDocumentsDir,
  platform: 'linux',
  ...extra,
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
const read = (path: string) => readFileSync(path, 'utf-8');

/** Every file under `dir` (relative path -> content), for before/after comparisons. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(path.slice(dir.length), readFileSync(path, 'utf-8'));
    }
  };
  walk(dir);
  return files;
}

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
}

/** A home that already has a person's own content in every file `init` will touch. */
function seedUserHome(): Record<string, string> {
  const userFiles: Record<string, string> = {
    [bashProfilePath(home)]: '# my bashrc\nexport EDITOR=vim\nalias ll="ls -la"\n',
    // no trailing newline: the awkward case for appending/removing a block
    [zshProfilePath(home)]: '# my zshrc\nsetopt autocd',
    [join(home, '.claude', 'settings.json')]: JSON.stringify(
      {
        permissions: { allow: ['Bash(ls)'] },
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-own-linter --fast' }] },
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'format-check' }] },
          ],
          PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'notify' }] }],
        },
      },
      null,
      2,
    ),
    [join(home, '.cursor', 'hooks.json')]: JSON.stringify(
      { version: 1, hooks: { beforeShellExecution: [{ command: 'my-cursor-guard' }] } },
      null,
      2,
    ),
    [join(home, '.codex', 'hooks.json')]: JSON.stringify(
      {
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'codex-own' }] }],
        },
      },
      null,
      2,
    ),
    [join(home, '.gemini', 'config', 'hooks.json')]: JSON.stringify(
      {
        'my-hook': {
          enabled: true,
          PreToolUse: [
            {
              matcher: 'run_command',
              hooks: [{ type: 'command', command: 'agy-own', timeout: 5 }],
            },
          ],
        },
      },
      null,
      2,
    ),
  };
  for (const [path, content] of Object.entries(userFiles)) write(path, content);
  return userFiles;
}

describe('runUninstall: the exact inverse of init', () => {
  it('puts every file back the way it was, byte for byte (JSON files: structurally)', () => {
    const userFiles = seedUserHome();
    gitInit(project);
    runInit(project, { ...initOpts(), all: true, gitHook: true, ci: true });
    // sanity: init really did write into those files, plus new ones
    expect(read(bashProfilePath(home))).toContain('slopsquatshield');
    expect(existsSync(powerShellProfiles({ home, platform: 'linux' })[0].path)).toBe(true);
    expect(existsSync(join(home, '.config', 'slopsquatshield', 'bin'))).toBe(true);
    expect(existsSync(join(project, '.git', 'hooks', 'pre-commit'))).toBe(true);

    const result = runUninstall(project, uninstallOpts());

    expect(result.ok).toBe(true);
    // shell profiles: exact bytes
    expect(read(bashProfilePath(home))).toBe(userFiles[bashProfilePath(home)]);
    // zsh had no trailing newline. `init` appends "\n\n<block>" to both "x" and "x\n", so the two
    // are indistinguishable afterwards: no exact inverse exists, and ending the file with a newline
    // (the POSIX convention) is the right result.
    expect(read(zshProfilePath(home))).toBe(`${userFiles[zshProfilePath(home)]}\n`);
    // host configs: the same JSON the person had, with nothing of ours left
    for (const path of Object.keys(userFiles).filter((p) => p.endsWith('.json'))) {
      expect(JSON.parse(read(path))).toEqual(JSON.parse(userFiles[path] as string));
    }
    // things init created from nothing are gone
    expect(existsSync(powerShellProfiles({ home, platform: 'linux' })[0].path)).toBe(false);
    expect(existsSync(join(home, '.config', 'slopsquatshield'))).toBe(false);
    expect(existsSync(join(project, '.git', 'hooks', 'pre-commit'))).toBe(false);
    // the project's own file is never deleted
    expect(existsSync(join(project, '.slopsquatshield'))).toBe(true);
  });

  it('leaves no trace of "slopsquatshield" in any file under the home directory', () => {
    seedUserHome();
    runInit(project, { ...initOpts(), all: true, ci: true });

    runUninstall(project, uninstallOpts());

    const leaks = [...snapshot(home)].filter(([, content]) => /slopsquatshield/i.test(content));
    expect(leaks.map(([path]) => path)).toEqual([]);
  });

  it('is idempotent: a second run finds nothing and still succeeds', () => {
    seedUserHome();
    runInit(project, { ...initOpts(), all: true });
    runUninstall(project, uninstallOpts());
    const afterFirst = snapshot(home);

    const second = runUninstall(project, uninstallOpts());

    expect(second.ok).toBe(true);
    expect(second.actions.every((a) => a.outcome === 'not-found')).toBe(true);
    expect(snapshot(home)).toEqual(afterFirst);
  });

  it('on a machine where nothing was ever set up, finds nothing and changes nothing', () => {
    const before = snapshot(home);
    const result = runUninstall(project, uninstallOpts());
    expect(result.ok).toBe(true);
    expect(result.actions.every((a) => a.outcome === 'not-found')).toBe(true);
    expect(snapshot(home)).toEqual(before);
  });
});

describe('runUninstall: PowerShell profiles on Windows', () => {
  const win = (extra: object = {}) => ({ ...uninstallOpts(), platform: 'win32', ...extra });
  const winInit = (extra: object = {}) => ({
    ...initOpts(),
    platform: 'win32',
    shell: true,
    ...extra,
  });

  it('removes the block from both PowerShell 7 and Windows PowerShell 5.1', () => {
    runInit(project, winInit());
    const profiles = powerShellProfiles({ home, platform: 'win32' });
    for (const { path } of profiles) expect(existsSync(path)).toBe(true);

    const result = runUninstall(project, win());

    expect(result.ok).toBe(true);
    for (const { path } of profiles) expect(existsSync(path)).toBe(false);
    const surfaces = result.actions.map((a) => a.surface);
    expect(surfaces).toContain('Shell wrapper (PowerShell 7)');
    expect(surfaces).toContain('Shell wrapper (Windows PowerShell 5.1)');
  });

  it('also cleans a block an older init left under <home>\\Documents when Documents is redirected', () => {
    const redirected = join(home, 'OneDrive', 'Documents');
    // An older init wrote here, before it knew about the redirect.
    runInit(project, winInit());
    const legacy = powerShellProfiles({ home, platform: 'win32' });
    // A newer init wrote into the real folder.
    runInit(project, winInit({ detectDocumentsDir: () => redirected }));
    const current = powerShellProfiles({ home, platform: 'win32', documentsDir: redirected });

    const result = runUninstall(project, win({ detectDocumentsDir: () => redirected }));

    expect(result.ok).toBe(true);
    for (const { path } of [...legacy, ...current]) expect(existsSync(path)).toBe(false);
  });

  it('lists each path once when Documents is not redirected', () => {
    runInit(project, winInit());
    const result = runUninstall(project, win());
    const ps = result.actions.filter((a) => a.surface.includes('PowerShell'));
    expect(ps.map((a) => a.location)).toEqual([...new Set(ps.map((a) => a.location))]);
    expect(ps).toHaveLength(2);
  });

  it('--dry-run lists both profiles and leaves them in place', () => {
    runInit(project, winInit());
    const profiles = powerShellProfiles({ home, platform: 'win32' });

    const result = runUninstall(project, win({ dryRun: true }));

    expect(result.dryRun).toBe(true);
    for (const { path } of profiles) {
      expect(existsSync(path)).toBe(true);
      expect(result.actions.some((a) => a.location === path && a.outcome === 'removed')).toBe(true);
    }
  });
});

describe('runUninstall --dry-run', () => {
  it('reports everything it would remove and changes nothing at all', () => {
    seedUserHome();
    gitInit(project);
    runInit(project, { ...initOpts(), all: true, gitHook: true, ci: true });
    const homeBefore = snapshot(home);
    const projectBefore = snapshot(project);

    const result = runUninstall(project, uninstallOpts({ dryRun: true }));

    expect(result.dryRun).toBe(true);
    const surfaces = result.actions.filter((a) => a.outcome === 'removed').map((a) => a.surface);
    expect(surfaces).toEqual(
      expect.arrayContaining([
        'Shell wrapper (bash)',
        'Shell wrapper (zsh)',
        'Claude Code hook',
        'Cursor hook',
        'Codex hook',
        'Antigravity hook',
        'Git pre-commit hook',
        'Launcher and CI shims',
      ]),
    );
    expect(snapshot(home)).toEqual(homeBefore);
    expect(snapshot(project)).toEqual(projectBefore);
  });
});

describe('runUninstall never goes past what init wrote', () => {
  it('keeps a pre-commit hook someone else chained after ours, exactly as it was', () => {
    gitInit(project);
    const hook = join(project, '.git', 'hooks', 'pre-commit');
    const theirs = '#!/bin/sh\necho "their hook"\nexit 0\n';
    write(hook, theirs);
    runInit(project, { ...initOpts(), gitHook: true });
    expect(read(hook)).toContain('slopsquatshield');

    const result = runUninstall(project, uninstallOpts());

    expect(read(hook)).toBe(theirs);
    expect(result.actions.find((a) => a.surface === 'Git pre-commit hook')?.outcome).toBe(
      'removed',
    );
  });

  it('removes project-level hooks too, when run from a project', () => {
    runInit(project, { ...initOpts(), claudeCode: true, project: true });
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(true);

    runUninstall(project, uninstallOpts());

    const settings = join(project, '.claude', 'settings.json');
    expect(!existsSync(settings) || !/slopsquatshield/.test(read(settings))).toBe(true);
  });

  it('never deletes the project allowlist or config', () => {
    write(join(project, '.slopsquatshield'), 'internal-utils\n');
    write(join(project, '.slopsquatshieldrc'), '{"thresholds":{"minAgeDays":30}}');
    runInit(project, { ...initOpts(), all: true });

    runUninstall(project, uninstallOpts());

    expect(read(join(project, '.slopsquatshield'))).toBe('internal-utils\n');
    expect(read(join(project, '.slopsquatshieldrc'))).toBe('{"thresholds":{"minAgeDays":30}}');
  });

  it('leaves a config that is not valid JSON untouched, says so, and fails', () => {
    const bad = join(home, '.claude', 'settings.json');
    write(bad, '{ not json');
    runInit(project, { ...initOpts(), cursor: true, all: false });
    mkdirSync(join(home, '.cursor'), { recursive: true });
    runInit(project, { ...initOpts(), cursor: true });

    const result = runUninstall(project, uninstallOpts());

    expect(read(bad)).toBe('{ not json');
    expect(result.ok).toBe(false);
    const action = result.actions.find((a) => a.surface === 'Claude Code hook');
    expect(action?.outcome).toBe('left-untouched');
    expect(action?.note).toContain('not valid JSON');
    // the rest was still removed
    expect(result.actions.find((a) => a.surface === 'Cursor hook')?.outcome).toBe('removed');
  });
});

describe('runUninstall --purge', () => {
  it('deletes the registry cache only when asked, and only a directory that is ours', () => {
    const cacheDir = join(home, 'cache', 'slopsquatshield-nodejs');
    write(join(cacheDir, 'registry-cache.sqlite3'), 'db');
    const cachePath = join(cacheDir, 'registry-cache.sqlite3');

    runUninstall(project, uninstallOpts({ cachePath }));
    expect(existsSync(cacheDir)).toBe(true);

    runUninstall(project, uninstallOpts({ cachePath, purge: true }));
    expect(existsSync(cacheDir)).toBe(false);
  });

  it('refuses to delete a directory that is not named for us', () => {
    const notOurs = join(home, 'cache', 'something-else');
    write(join(notOurs, 'registry-cache.sqlite3'), 'db');

    const result = runUninstall(
      project,
      uninstallOpts({ cachePath: join(notOurs, 'registry-cache.sqlite3'), purge: true }),
    );

    expect(existsSync(notOurs)).toBe(true);
    expect(result.actions.find((a) => a.surface === 'Registry cache')?.outcome).toBe('not-found');
  });
});

describe('runUninstall from the home directory', () => {
  it('does not treat home as a project: each user-level file is handled once', () => {
    runInit(project, { ...initOpts(), claudeCode: true });

    const result = runUninstall(home, uninstallOpts());

    expect(result.actions.filter((a) => a.surface === 'Claude Code hook')).toHaveLength(1);
    expect(result.actions.some((a) => a.surface.includes('(project)'))).toBe(false);
  });
});
