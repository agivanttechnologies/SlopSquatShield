// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Style } from './style.js';

/** One package in a human-readable report: a heading line, then its reason indented beneath. */
export interface FindingRow {
  kind: 'block' | 'warn' | 'unverified';
  name: string;
  /** What follows the name, dimmed: `npm · package.json [dependencies]`. */
  meta: string;
  /** The reason, wrapped to the terminal under the name. */
  detail: string;
}

/** Names longer than this don't widen the column for everyone; they just push their own meta. */
const MAX_NAME_COLUMN = 24;
const INDENT = '    ';

/** Word-wraps `text` to `width` columns, each line starting with `indent`. A long word is never cut. */
export function wrap(text: string, width: number, indent = ''): string[] {
  const room = Math.max(20, width - indent.length);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > room) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

/**
 * The finding list every human-readable surface shares (scan, pre-commit, the install wrapper):
 *
 *     ✗ zz-ghost-pkg       npm · package.json [dependencies]
 *         Does not exist on the npm registry.
 *
 * Names are never truncated — a `groupId:artifactId` longer than the column just pushes its meta
 * right — and the reason wraps to the terminal instead of a fixed-width table column.
 */
export function renderFindings(rows: readonly FindingRow[], style: Style): string[] {
  const column = Math.min(MAX_NAME_COLUMN, Math.max(0, ...rows.map((r) => r.name.length)));
  const out: string[] = [];
  for (const row of rows) {
    const color = row.kind === 'block' ? style.red : row.kind === 'warn' ? style.yellow : style.dim;
    const mark =
      row.kind === 'block'
        ? style.sym.block
        : row.kind === 'warn'
          ? style.sym.warn
          : style.sym.unverified;
    const gap = ' '.repeat(Math.max(1, column - row.name.length + 2));
    const width = mark.length + 1 + row.name.length + gap.length + row.meta.length;
    if (width <= style.width) {
      out.push(`${color(mark)} ${color(row.name)}${gap}${style.dim(row.meta)}`);
    } else {
      // Too wide for the terminal: the meta gets its own line rather than wrapping mid-word.
      out.push(`${color(mark)} ${color(row.name)}`, `${INDENT}${style.dim(row.meta)}`);
    }
    out.push(...wrap(row.detail, style.width, INDENT));
  }
  return out;
}

/** `1 package`, `3 packages`. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
