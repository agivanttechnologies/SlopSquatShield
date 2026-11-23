// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cursorHookState,
  cursorHooksConfigPath,
  hasCursorHook,
  writeCursorHookConfig,
} from '../../src/hooks/cursor-config.js';
import { cursorHookCommand } from '../../src/hooks/hook-command.js';

let tmpDir: string;
let homeDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ssg-cursor-'));
  homeDir = mkdtempSync(join(tmpdir(), 'ssg-cursor-home-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

function writeSettings(settings: unknown): string {
  const path = cursorHooksConfigPath(tmpDir);
  mkdirSync(join(tmpDir, '.cursor'), { recursive: true });
  writeFileSync(path, typeof settings === 'string' ? settings : JSON.stringify(settings));
  return path;
}

describe('hasCursorHook / writeCursorHookConfig', () => {
  it('reports false when .cursor/hooks.json does not exist', () => {
    expect(hasCursorHook(tmpDir, homeDir)).toBe(false);
  });

  it('writes a beforeShellExecution hook pointing at the absolute launcher path', () => {
    const result = writeCursorHookConfig(tmpDir, homeDir, 'linux');

    expect(result).toBe('installed');
    expect(hasCursorHook(tmpDir, homeDir, 'linux')).toBe(true);

    const settings = JSON.parse(readFileSync(cursorHooksConfigPath(tmpDir), 'utf-8'));
    expect(settings.hooks.beforeShellExecution).toEqual([
      {
        command: `"${join(homeDir, '.config', 'slopsquatshield', 'bin', 'slopsquatshield')}" hook cursor`,
      },
    ]);
  });

  it('uses the .cmd launcher on Windows', () => {
    expect(cursorHookCommand(homeDir, 'win32')).toBe(
      `"${join(homeDir, '.config', 'slopsquatshield', 'bin', 'slopsquatshield.cmd')}" hook cursor`,
    );
  });

  it('is idempotent — a second write does not duplicate the hook entry', () => {
    writeCursorHookConfig(tmpDir, homeDir, 'linux');
    const second = writeCursorHookConfig(tmpDir, homeDir, 'linux');

    expect(second).toBe('already-installed');
    const settings = JSON.parse(readFileSync(cursorHooksConfigPath(tmpDir), 'utf-8'));
    expect(settings.hooks.beforeShellExecution).toHaveLength(1);
  });

  it('merges into an existing hooks.json without clobbering unrelated keys', () => {
    const path = writeSettings({ version: 1, someOtherSetting: true });

    writeCursorHookConfig(tmpDir, homeDir, 'linux');

    const settings = JSON.parse(readFileSync(path, 'utf-8'));
    expect(settings.someOtherSetting).toBe(true);
    expect(settings.hooks.beforeShellExecution).toHaveLength(1);
  });

  it('adds to an existing beforeShellExecution list rather than replacing it', () => {
    const path = writeSettings({
      version: 1,
      hooks: { beforeShellExecution: [{ command: 'some-other-tool' }] },
    });

    writeCursorHookConfig(tmpDir, homeDir, 'linux');

    const settings = JSON.parse(readFileSync(path, 'utf-8'));
    expect(settings.hooks.beforeShellExecution).toEqual([
      { command: 'some-other-tool' },
      { command: cursorHookCommand(homeDir, 'linux') },
    ]);
  });

  it('upgrades a legacy bare-name entry in place instead of duplicating it', () => {
    const path = writeSettings({
      version: 1,
      hooks: { beforeShellExecution: [{ command: 'slopsquatshield hook cursor' }] },
    });

    expect(cursorHookState(tmpDir, homeDir, 'linux')).toBe('outdated');
    expect(writeCursorHookConfig(tmpDir, homeDir, 'linux')).toBe('upgraded');

    const settings = JSON.parse(readFileSync(path, 'utf-8'));
    expect(settings.hooks.beforeShellExecution).toEqual([
      { command: cursorHookCommand(homeDir, 'linux') },
    ]);
  });

  it('refuses to overwrite a hooks.json that is not valid JSON', () => {
    const broken = '{ not json';
    const path = writeSettings(broken);

    expect(writeCursorHookConfig(tmpDir, homeDir, 'linux')).toBe('invalid-json');
    expect(readFileSync(path, 'utf-8')).toBe(broken);
  });
});
