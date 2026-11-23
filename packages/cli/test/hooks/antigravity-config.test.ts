// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  antigravityHookState,
  antigravityHooksConfigPath,
  writeAntigravityHookConfig,
} from '../../src/hooks/antigravity-config.js';
import { antigravityHookCommand } from '../../src/hooks/hook-command.js';

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ssg-agy-'));
  home = mkdtempSync(join(tmpdir(), 'ssg-agy-home-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

function seed(scope: 'user' | 'project', content: unknown): string {
  const path = antigravityHooksConfigPath(root, scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

describe('antigravity hooks.json', () => {
  it('uses ~/.gemini/config/hooks.json for user scope and .agents/hooks.json for project', () => {
    expect(antigravityHooksConfigPath('/h', 'user')).toBe(
      join('/h', '.gemini', 'config', 'hooks.json'),
    );
    expect(antigravityHooksConfigPath('/p', 'project')).toBe(join('/p', '.agents', 'hooks.json'));
  });

  it('writes the named-hook shape (no top-level "hooks" key) targeting run_command', () => {
    expect(writeAntigravityHookConfig(root, 'user', home, 'linux')).toBe('installed');

    const file = JSON.parse(readFileSync(antigravityHooksConfigPath(root, 'user'), 'utf-8'));
    expect(file.hooks).toBeUndefined();
    expect(file.slopsquatshield.PreToolUse).toEqual([
      {
        matcher: 'run_command',
        hooks: [{ type: 'command', command: antigravityHookCommand(home, 'linux'), timeout: 30 }],
      },
    ]);
  });

  it('is idempotent', () => {
    writeAntigravityHookConfig(root, 'project', home, 'linux');
    expect(writeAntigravityHookConfig(root, 'project', home, 'linux')).toBe('already-installed');
    expect(antigravityHookState(root, 'project', home, 'linux')).toBe('current');
  });

  it('keeps other named hooks and their events untouched', () => {
    const path = seed('user', {
      'safety-gate': {
        enabled: false,
        PreToolUse: [
          { matcher: 'run_command', hooks: [{ type: 'command', command: './check.sh' }] },
        ],
        Stop: [{ matcher: '', hooks: [] }],
      },
    });
    writeAntigravityHookConfig(root, 'user', home, 'linux');

    const file = JSON.parse(readFileSync(path, 'utf-8'));
    expect(file['safety-gate'].enabled).toBe(false);
    expect(file['safety-gate'].Stop).toBeDefined();
    expect(file['safety-gate'].PreToolUse[0].hooks[0].command).toBe('./check.sh');
    expect(file.slopsquatshield).toBeDefined();
  });

  it('finds and upgrades our entry wherever it lives, rather than adding a second', () => {
    const path = seed('user', {
      mine: {
        PreToolUse: [
          {
            matcher: 'run_command',
            hooks: [{ type: 'command', command: 'slopsquatshield hook antigravity' }],
          },
        ],
      },
    });
    expect(antigravityHookState(root, 'user', home, 'linux')).toBe('outdated');
    expect(writeAntigravityHookConfig(root, 'user', home, 'linux')).toBe('upgraded');

    const file = JSON.parse(readFileSync(path, 'utf-8'));
    expect(Object.keys(file)).toEqual(['mine']);
    expect(file.mine.PreToolUse[0].hooks[0]).toEqual({
      type: 'command',
      command: antigravityHookCommand(home, 'linux'),
      timeout: 30,
    });
  });

  it('leaves an invalid-JSON file untouched', () => {
    const path = seed('user', '{ nope');
    expect(writeAntigravityHookConfig(root, 'user', home, 'linux')).toBe('invalid-json');
    expect(readFileSync(path, 'utf-8')).toBe('{ nope');
  });
});
