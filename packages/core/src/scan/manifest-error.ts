// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * A manifest that can't be parsed (NFR-3.3): reported as `file:line:column: reason`, never as a
 * stack trace. Line and column are 1-based, matching editors and compilers.
 */
export class ManifestParseError extends Error {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly reason: string;

  constructor(file: string, line: number, column: number, reason: string) {
    super(`${file}:${line}:${column}: ${reason}`);
    this.name = 'ManifestParseError';
    this.file = file;
    this.line = line;
    this.column = column;
    this.reason = reason;
  }
}

/** 1-based line/column of a character offset in `text`. */
export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}
