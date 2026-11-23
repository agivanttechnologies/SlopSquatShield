// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
/** Zero-based position/range, deliberately the same shape as VS Code's, without importing it. */
export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface TextEdit {
  range: Range;
  newText: string;
}

/** Offsets of the start of every line (handles \n and \r\n). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export function positionAt(starts: number[], offset: number): Position {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}

export function rangeOf(starts: number[], startOffset: number, endOffset: number): Range {
  return { start: positionAt(starts, startOffset), end: positionAt(starts, endOffset) };
}

/** A line's [start, end) offsets, where `end` excludes the line terminator. */
export function lineBounds(text: string, starts: number[], line: number): [number, number] {
  const start = starts[line];
  let end = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
  if (end > start && text[end - 1] === '\r') end -= 1;
  return [start, end];
}
