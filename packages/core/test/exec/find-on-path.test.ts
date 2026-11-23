// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findOnPath } from '../../src/exec/find-on-path.js';

describe('findOnPath', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ssg-find-on-path-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const touch = (...parts: string[]) => {
    const path = join(root, ...parts);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '');
    chmodSync(path, 0o755);
    return path;
  };

  it('returns the first match on PATH as an absolute path', () => {
    const first = touch('a', 'mvn');
    touch('b', 'mvn');
    const env = { PATH: [join(root, 'a'), join(root, 'b')].join(delimiter) };
    expect(findOnPath('mvn', env, 'linux')).toBe(first);
  });

  it('returns undefined when the command is not on PATH', () => {
    expect(findOnPath('mvn', { PATH: join(root, 'empty') }, 'linux')).toBeUndefined();
  });

  it('never searches relative or empty PATH entries (the current directory)', () => {
    const env = { PATH: ['', '.', 'relative/bin'].join(delimiter) };
    expect(findOnPath('node', env, 'linux')).toBeUndefined();
  });

  it('does not treat a directory with the command name as the command', () => {
    mkdirSync(join(root, 'bin', 'mvn'), { recursive: true });
    expect(findOnPath('mvn', { PATH: join(root, 'bin') }, 'linux')).toBeUndefined();
  });

  it('applies PATHEXT on Windows', () => {
    const cmd = touch('win', 'mvn.cmd');
    const env = { Path: join(root, 'win'), PATHEXT: '.EXE;.CMD' };
    expect(findOnPath('mvn', env, 'win32')?.toLowerCase()).toBe(cmd.toLowerCase());
  });
});
