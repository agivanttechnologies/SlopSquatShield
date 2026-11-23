// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { extractInstallCommandDeps } from './install-command.js';
import type { ExtractedDependency } from './types.js';

const FENCED_BLOCK_RE = /```[^\n`]*\n([\s\S]*?)```/g;
const INLINE_SPAN_RE = /`([^`\n]+)`/g;

function removeRanges(text: string, ranges: [number, number][]): string {
  if (ranges.length === 0) return text;

  let result = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    result += text.slice(cursor, start);
    cursor = end;
  }
  result += text.slice(cursor);
  return result;
}

/**
 * Extracts install-command dependencies from Markdown, restricted to fenced code
 * blocks and inline code spans (FR-1.5) — prose that merely *mentions* a command
 * (a tutorial sentence, a changelog note) is never scanned, so it can't be misread
 * as an actual install. Engine capability only; no v1 surface wires this in by default.
 */
export function extractMarkdownInstallCommandDeps(
  markdown: string,
  source = 'markdown',
): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];
  const fencedRanges: [number, number][] = [];

  for (const match of markdown.matchAll(FENCED_BLOCK_RE)) {
    deps.push(...extractInstallCommandDeps(match[1], source));
    fencedRanges.push([match.index, match.index + match[0].length]);
  }

  // Inline spans are scanned on the fence-stripped text so a fenced block's own
  // backticks/content can never be double-counted as an inline span too.
  const withoutFences = removeRanges(markdown, fencedRanges);
  for (const match of withoutFences.matchAll(INLINE_SPAN_RE)) {
    deps.push(...extractInstallCommandDeps(match[1], source));
  }

  return deps;
}
