// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeCodeHookState,
  claudeCodeSettingsPath,
  hasClaudeCodeHook,
  writeClaudeCodeHookConfig,
} from '../../src/hooks/claude-code-config.js';
import { claudeCodeHookCommand } from '../../src/hooks/hook-command.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ssg-claude-code-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeSettings(settings: unknown): string {
  const path = claudeCodeSettingsPath(tmpDir);
  mkdirSync(join(tmpDir, '.claude'), { recursive: true });
  writeFileSync(path, typeof settings === 'string' ? settings : JSON.stringify(settings));
  return path;
}

describe('hasClaudeCodeHook / writeClaudeCodeHookConfig', () => {
  it('reports false when .claude/settings.json does not exist', () => {
    expect(hasClaudeCodeHook(tmpDir)).toBe(false);
    expect(claudeCodeHookState(tmpDir)).toBe('absent');
  });

  it('writes a valid PreToolUse hook on a fresh root (no .claude dir yet)', () => {
    const result = writeClaudeCodeHookConfig(tmpDir);

    expect(result).toBe('installed');
    expect(hasClaudeCodeHook(tmpDir)).toBe(true);

    const settings = JSON.parse(readFileSync(claudeCodeSettingsPath(tmpDir), 'utf-8'));
    expect(settings.hooks.PreToolUse).toEqual([
      { matcher: 'Bash', hooks: [{ type: 'command', command: claudeCodeHookCommand() }] },
    ]);
  });

  it('points the hook at the fixed launcher path, never a bare PATH-dependent name', () => {
    expect(claudeCodeHookCommand()).toBe(
      '"$HOME/.config/slopsquatshield/bin/slopsquatshield" hook claude-code',
    );
  });

  it('is idempotent — a second write does not duplicate the hook entry', () => {
    writeClaudeCodeHookConfig(tmpDir);
    const second = writeClaudeCodeHookConfig(tmpDir);

    expect(second).toBe('already-installed');
    const settings = JSON.parse(readFileSync(claudeCodeSettingsPath(tmpDir), 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks).toHaveLength(1);
  });

  it('merges into an existing settings.json without clobbering unrelated keys', () => {
    const path = writeSettings({ someOtherSetting: true });

    writeClaudeCodeHookConfig(tmpDir);

    const settings = JSON.parse(readFileSync(path, 'utf-8'));
    expect(settings.someOtherSetting).toBe(true);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  it('adds to an existing Bash matcher group rather than creating a second one', () => {
    const path = writeSettings({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'some-other-tool' }] }],
      },
    });

    writeClaudeCodeHookConfig(tmpDir);

    const settings = JSON.parse(readFileSync(path, 'utf-8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0].hooks).toEqual([
      { type: 'command', command: 'some-other-tool' },
      { type: 'command', command: claudeCodeHookCommand() },
    ]);
  });

  describe('legacy and hand-written commands (the 2026-10-01 nvm exit-127 case)', () => {
    it.each([
      ['legacy bare name', 'slopsquatshield hook claude-code'],
      [
        'hand-written absolute nvm path',
        '/home/user/.nvm/versions/node/v24.21.0/bin/slopsquatshield hook claude-code',
      ],
    ])('upgrades a %s in place instead of adding a duplicate', (_label, legacy) => {
      const path = writeSettings({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: legacy }] }] },
      });

      expect(claudeCodeHookState(tmpDir)).toBe('outdated');
      expect(hasClaudeCodeHook(tmpDir)).toBe(false);

      expect(writeClaudeCodeHookConfig(tmpDir)).toBe('upgraded');

      const settings = JSON.parse(readFileSync(path, 'utf-8'));
      expect(settings.hooks.PreToolUse[0].hooks).toEqual([
        { type: 'command', command: claudeCodeHookCommand() },
      ]);
      expect(claudeCodeHookState(tmpDir)).toBe('current');
    });
  });

  it('refuses to overwrite a settings.json that is not valid JSON', () => {
    const broken = '{ "hooks": // a user comment\n';
    const path = writeSettings(broken);

    expect(claudeCodeHookState(tmpDir)).toBe('invalid-json');
    expect(writeClaudeCodeHookConfig(tmpDir)).toBe('invalid-json');
    expect(readFileSync(path, 'utf-8')).toBe(broken);
  });

  it('tolerates a matcher group with no hooks array', () => {
    writeSettings({ hooks: { PreToolUse: [{ matcher: 'Bash' }] } });

    expect(claudeCodeHookState(tmpDir)).toBe('absent');
    expect(writeClaudeCodeHookConfig(tmpDir)).toBe('installed');
    expect(claudeCodeHookState(tmpDir)).toBe('current');
  });
});
