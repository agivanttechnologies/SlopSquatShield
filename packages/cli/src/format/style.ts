// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { CREDIT } from '@slopsquatshield/core';
import pc from 'picocolors';

type Env = Readonly<Record<string, string | undefined>>;

/** The part of a Node write stream these helpers look at; tests pass a plain object. */
export interface OutputStream {
  isTTY?: boolean;
  columns?: number;
}

/** The symbols every human-readable output uses, so a finding looks the same everywhere. */
export interface Symbols {
  block: string;
  warn: string;
  unverified: string;
  ok: string;
  skipped: string;
  dot: string;
}

const UNICODE: Symbols = {
  block: '✗',
  warn: '!',
  unverified: '?',
  ok: '✓',
  skipped: '–',
  dot: '·',
};
const ASCII: Symbols = { block: 'x', warn: '!', unverified: '?', ok: 'ok', skipped: '-', dot: '-' };

export interface Style {
  /** True when the output goes to a terminal a person is looking at. */
  tty: boolean;
  /** Whether colour codes are written at all. */
  color: boolean;
  /** Where text should wrap: the terminal's width, or 80 when it isn't a terminal. */
  width: number;
  sym: Symbols;
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
}

/**
 * Colour only for a terminal, and never against the person's wishes: `NO_COLOR` (any non-empty
 * value) turns it off, `FORCE_COLOR` turns it on — except `FORCE_COLOR=0`/`false`, which picocolors
 * reads as "on" but which means off everywhere else. `TERM=dumb` is off.
 */
export function colorEnabled(stream: OutputStream, env: Env = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) return force !== '0' && force.toLowerCase() !== 'false';
  if (env.TERM === 'dumb') return false;
  return stream.isTTY === true;
}

/**
 * Unicode symbols everywhere except where they're known to come out as boxes: `TERM=dumb`, and the
 * legacy Windows console (no Windows Terminal, VS Code, ConEmu or other `TERM`-setting terminal).
 */
export function unicodeEnabled(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (env.TERM === 'dumb') return false;
  if (platform !== 'win32') return true;
  return Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.ConEmuANSI === 'ON' || env.TERM);
}

/** The one place that decides how a human-readable output looks for a given stream. */
export function createStyle(
  stream: OutputStream = process.stdout,
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): Style {
  const color = colorEnabled(stream, env);
  const c = pc.createColors(color);
  return {
    tty: stream.isTTY === true,
    color,
    width: stream.isTTY && stream.columns ? stream.columns : 80,
    sym: unicodeEnabled(env, platform) ? UNICODE : ASCII,
    red: c.red,
    yellow: c.yellow,
    green: c.green,
    dim: c.dim,
    bold: c.bold,
  };
}

/** A plain style: no colour, Unicode, 80 columns, not a terminal. Mainly for tests. */
export function plainStyle(over: Partial<Style> = {}): Style {
  return { ...createStyle({ isTTY: false }, {}, 'linux'), ...over };
}

/**
 * The credit, as the last lines of a human-readable output: a blank line, then the credit, dimmed.
 * Only for a terminal — piped or redirected output (a log, a file, another program) doesn't get it.
 * Never used for hook, wrapper or JSON output.
 */
export function creditLines(style: Style): string[] {
  return style.tty ? ['', style.dim(CREDIT)] : [];
}
