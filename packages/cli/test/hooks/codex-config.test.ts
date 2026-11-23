// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CODEX_HOOK_TIMEOUT_SECONDS,
  codexHookState,
  codexHooksConfigPath,
  hasCodexHook,
  writeCodexHookConfig,
} from '../../src/hooks/codex-config.js';
import { codexHookCommand, wslHookCommand } from '../../src/hooks/hook-command.js';

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ssg-codex-'));
  home = mkdtempSync(join(tmpdir(), 'ssg-codex-home-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function seed(content: unknown): string {
  const path = codexHooksConfigPath(root);
  mkdirSync(join(root, '.codex'), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

describe('writeCodexHookConfig / codexHookState', () => {
  it('writes a Bash PreToolUse hook with the absolute launcher path and a 30s timeout', () => {
    expect(codexHookState(root, home, 'linux')).toBe('absent');
    expect(writeCodexHookConfig(root, home, 'linux')).toBe('installed');

    const file = JSON.parse(readFileSync(codexHooksConfigPath(root), 'utf-8'));
    expect(file.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: codexHookCommand(home, 'linux'), timeout: 30 }],
      },
    ]);
    expect(CODEX_HOOK_TIMEOUT_SECONDS).toBe(30);
    expect(hasCodexHook(root, home, 'linux')).toBe(true);
  });

  it('is idempotent', () => {
    writeCodexHookConfig(root, home, 'linux');
    expect(writeCodexHookConfig(root, home, 'linux')).toBe('already-installed');
    const file = JSON.parse(readFileSync(codexHooksConfigPath(root), 'utf-8'));
    expect(file.hooks.PreToolUse[0].hooks).toHaveLength(1);
  });

  it('upgrades a legacy bare-name entry (no timeout) in place', () => {
    const path = seed({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'slopsquatshield hook codex' }] },
        ],
      },
    });
    expect(codexHookState(root, home, 'linux')).toBe('outdated');
    expect(writeCodexHookConfig(root, home, 'linux')).toBe('upgraded');

    const hooks = JSON.parse(readFileSync(path, 'utf-8')).hooks.PreToolUse[0].hooks;
    expect(hooks).toEqual([
      { type: 'command', command: codexHookCommand(home, 'linux'), timeout: 30 },
    ]);
  });

  it('merges into an existing Bash group and keeps unrelated hooks and keys', () => {
    const path = seed({
      other: true,
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-audit.sh' }] }],
        PostToolUse: [{ matcher: '*', hooks: [] }],
      },
    });
    writeCodexHookConfig(root, home, 'linux');

    const file = JSON.parse(readFileSync(path, 'utf-8'));
    expect(file.other).toBe(true);
    expect(file.hooks.PostToolUse).toBeDefined();
    expect(file.hooks.PreToolUse).toHaveLength(1);
    expect(file.hooks.PreToolUse[0].hooks.map((h: { command: string }) => h.command)).toEqual([
      'my-audit.sh',
      codexHookCommand(home, 'linux'),
    ]);
  });

  it('leaves an invalid-JSON hooks.json untouched', () => {
    const path = seed('{ broken');
    expect(writeCodexHookConfig(root, home, 'linux')).toBe('invalid-json');
    expect(readFileSync(path, 'utf-8')).toBe('{ broken');
  });

  it('uses an explicit command for a WSL distro (forward slashes, POSIX home)', () => {
    const cmd = wslHookCommand('codex', '/home/user');
    expect(cmd).toBe('"/home/user/.config/slopsquatshield/bin/slopsquatshield" hook codex');
    writeCodexHookConfig(root, undefined, undefined, cmd);
    expect(codexHookState(root, undefined, undefined, cmd)).toBe('current');
  });
});
