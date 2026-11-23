// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../../src/commands/doctor.js';
import { runInit } from '../../src/commands/init.js';
import {
  GIT_HOOK_MARKER_START,
  buildGitHookBlock,
  gitHookState,
  gitHooksDir,
  installGitHook,
} from '../../src/hooks/git-hook.js';

let repo: string;
let home: string;
let hookPath: string;

const git = (args: string[], cwd = repo) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ssg-githook-repo-'));
  home = mkdtempSync(join(tmpdir(), 'ssg-githook-home-'));
  git(['init', '-q']);
  hookPath = join(repo, '.git', 'hooks', 'pre-commit');
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('the hook block', () => {
  it('calls the launcher by its stable $HOME path with --staged, and states the override order', () => {
    const block = buildGitHookBlock();
    expect(block).toContain(
      '"$HOME/.config/slopsquatshield/bin/slopsquatshield" precommit --staged',
    );
    expect(block).toContain('|| exit $?');
    expect(block).toMatch(/fix .*allow.*--no-verify/);
  });
});

describe('installGitHook (FR-20.4)', () => {
  it('creates a new executable sh hook', () => {
    expect(installGitHook(hookPath)).toBe('installed');

    const text = readFileSync(hookPath, 'utf-8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain(GIT_HOOK_MARKER_START);
    if (process.platform !== 'win32') expect(statSync(hookPath).mode & 0o111).toBeGreaterThan(0);
    expect(gitHookState(hookPath)).toBe('current');
  });

  it('is idempotent', () => {
    installGitHook(hookPath);
    const first = readFileSync(hookPath, 'utf-8');
    expect(installGitHook(hookPath)).toBe('already-installed');
    expect(readFileSync(hookPath, 'utf-8')).toBe(first);
    expect(first.match(new RegExp(GIT_HOOK_MARKER_START, 'g'))).toHaveLength(1);
  });

  it('chains with an existing shell hook: ours runs first, theirs is preserved verbatim', () => {
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho "my own check"\nexit 0\n');
    chmodSync(hookPath, 0o755);

    expect(installGitHook(hookPath)).toBe('installed');

    const text = readFileSync(hookPath, 'utf-8');
    expect(text.indexOf(GIT_HOOK_MARKER_START)).toBeLessThan(text.indexOf('my own check'));
    expect(text).toContain('echo "my own check"\nexit 0\n');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
  });

  it('adds a shebang when an existing hook has none', () => {
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(hookPath, 'echo plain\n');
    installGitHook(hookPath);
    const text = readFileSync(hookPath, 'utf-8');
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain('echo plain');
  });

  it('refuses to touch a hook written in another language', () => {
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    const python = '#!/usr/bin/env python3\nprint("hi")\n';
    writeFileSync(hookPath, python);

    expect(installGitHook(hookPath)).toBe('unsupported-existing-hook');
    expect(readFileSync(hookPath, 'utf-8')).toBe(python);
  });

  it('upgrades an older block in place without disturbing the rest', () => {
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(
      hookPath,
      `#!/bin/sh\n${GIT_HOOK_MARKER_START}\nold-command\n# <<< slopsquatshield pre-commit <<<\necho after\n`,
    );
    expect(gitHookState(hookPath)).toBe('outdated');

    expect(installGitHook(hookPath)).toBe('upgraded');

    const text = readFileSync(hookPath, 'utf-8');
    expect(text).not.toContain('old-command');
    expect(text).toContain('echo after');
    expect(gitHookState(hookPath)).toBe('current');
  });
});

describe('gitHooksDir', () => {
  it('finds .git/hooks in a plain repository', () => {
    expect(gitHooksDir(repo)).toBe(join(repo, '.git', 'hooks'));
  });

  it('honours core.hooksPath', () => {
    git(['config', 'core.hooksPath', '.githooks']);
    expect(gitHooksDir(repo)).toBe(join(repo, '.githooks'));
  });

  it('is undefined outside a repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ssg-not-a-repo-'));
    try {
      expect(gitHooksDir(outside)).toBeUndefined();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('init --git-hook and doctor', () => {
  const location = { nodePath: '/fake/node', entryPath: '/fake/dist/index.js', ephemeral: false };
  const opts = () => ({
    home,
    selfLocation: location,
    detectWslHome: () => undefined,
    platform: 'linux',
  });

  it('writes the hook into the current repository, and it is idempotent', () => {
    const first = runInit(repo, { ...opts(), gitHook: true });
    expect(first.gitHook).toEqual({ result: 'installed', path: hookPath });
    expect(first.launcher?.status).toBe('written');

    expect(runInit(repo, { ...opts(), gitHook: true }).gitHook?.result).toBe('already-installed');
  });

  it('says so when not inside a git repository, and writes nothing', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ssg-not-a-repo-'));
    try {
      expect(runInit(outside, { ...opts(), gitHook: true }).gitHook).toEqual({
        result: 'not-a-repo',
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('is never part of --all (it edits the repository, so it is explicit)', () => {
    mkdirSync(join(home, '.claude'));
    const result = runInit(repo, { ...opts(), all: true });
    expect(result.gitHook).toBeUndefined();
    expect(() => readFileSync(hookPath)).toThrow();
  });

  it('doctor reports missing, then ok, then outdated', async () => {
    const doctorOpts = () => ({
      home,
      cachePath: ':memory:',
      detectWslHome: () => undefined,
      selfLocation: location,
      platform: 'linux',
      pathExists: () => true,
      runHookCommand: async () => ({ code: 0, stdout: '{}', stderr: '' }),
    });
    const find = async () =>
      (await runDoctor(repo, doctorOpts())).checks.find((c) => c.surface === 'Git pre-commit hook');

    const missing = await find();
    expect(missing?.status).toBe('missing');
    expect(missing?.fixCommand).toBe('slopsquatshield init --git-hook');

    runInit(repo, { ...opts(), gitHook: true });
    expect((await find())?.status).toBe('ok');

    writeFileSync(
      hookPath,
      `#!/bin/sh\n${GIT_HOOK_MARKER_START}\nold\n# <<< slopsquatshield pre-commit <<<\n`,
    );
    expect((await find())?.status).toBe('outdated');
  });

  it('doctor reports nothing about it outside a git repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'ssg-not-a-repo-'));
    try {
      const report = await runDoctor(outside, {
        home,
        cachePath: ':memory:',
        detectWslHome: () => undefined,
        selfLocation: location,
        platform: 'linux',
        pathExists: () => true,
      });
      expect(report.checks.some((c) => c.surface === 'Git pre-commit hook')).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
