// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { CREDIT } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import {
  colorEnabled,
  createStyle,
  creditLines,
  plainStyle,
  unicodeEnabled,
} from '../../src/format/style.js';

const tty = { isTTY: true, columns: 132 };
const pipe = { isTTY: false };

describe('colorEnabled', () => {
  it('is on for a terminal and off for a pipe or file', () => {
    expect(colorEnabled(tty, {})).toBe(true);
    expect(colorEnabled(pipe, {})).toBe(false);
    expect(colorEnabled({}, {})).toBe(false);
  });

  it('NO_COLOR turns it off, even on a terminal and even with FORCE_COLOR', () => {
    expect(colorEnabled(tty, { NO_COLOR: '1' })).toBe(false);
    expect(colorEnabled(tty, { NO_COLOR: '1', FORCE_COLOR: '1' })).toBe(false);
  });

  it('an empty NO_COLOR is ignored (the spec says "present and not empty")', () => {
    expect(colorEnabled(tty, { NO_COLOR: '' })).toBe(true);
  });

  it('FORCE_COLOR turns it on for a pipe, but FORCE_COLOR=0 or false turns it off', () => {
    expect(colorEnabled(pipe, { FORCE_COLOR: '1' })).toBe(true);
    expect(colorEnabled(pipe, { FORCE_COLOR: '' })).toBe(true);
    expect(colorEnabled(tty, { FORCE_COLOR: '0' })).toBe(false);
    expect(colorEnabled(tty, { FORCE_COLOR: 'false' })).toBe(false);
  });

  it('TERM=dumb turns it off', () => {
    expect(colorEnabled(tty, { TERM: 'dumb' })).toBe(false);
  });
});

describe('unicodeEnabled', () => {
  it('is on for Linux and macOS, off for TERM=dumb', () => {
    expect(unicodeEnabled({}, 'linux')).toBe(true);
    expect(unicodeEnabled({}, 'darwin')).toBe(true);
    expect(unicodeEnabled({ TERM: 'dumb' }, 'linux')).toBe(false);
  });

  it('on Windows, only in a terminal known to draw it', () => {
    expect(unicodeEnabled({}, 'win32')).toBe(false);
    expect(unicodeEnabled({ WT_SESSION: 'x' }, 'win32')).toBe(true);
    expect(unicodeEnabled({ TERM_PROGRAM: 'vscode' }, 'win32')).toBe(true);
  });
});

describe('createStyle', () => {
  it('uses the terminal width, and 80 when it is not a terminal', () => {
    expect(createStyle(tty, {}, 'linux').width).toBe(132);
    expect(createStyle({ isTTY: false, columns: 132 }, {}, 'linux').width).toBe(80);
  });

  it('writes no escape codes when colour is off', () => {
    const style = createStyle(pipe, {}, 'linux');
    expect(style.red('x') + style.dim('y') + style.yellow('z')).toBe('xyz');
  });

  it('colours when it is on', () => {
    expect(createStyle(tty, {}, 'linux').red('x')).toContain('\x1b[');
  });

  it('falls back to ASCII symbols where Unicode is not safe', () => {
    expect(createStyle(tty, {}, 'linux').sym.block).toBe('✗');
    expect(createStyle(tty, {}, 'win32').sym.block).toBe('x');
  });
});

describe('creditLines', () => {
  it('ends terminal output with a blank line and the credit', () => {
    expect(creditLines(plainStyle({ tty: true }))).toEqual(['', CREDIT]);
  });

  it('adds nothing to piped output', () => {
    expect(creditLines(plainStyle())).toEqual([]);
  });
});
