// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Finding } from './findings.js';
import { type TextEdit, lineBounds, lineStarts } from './text.js';

export type QuickFixKind = 'remove' | 'allow' | 'did-you-mean';

/** A quick-fix described without VS Code types, so it can be unit-tested directly. */
export interface QuickFix {
  kind: QuickFixKind;
  title: string;
  /** Text edits to the manifest itself (remove, did-you-mean). */
  edits?: TextEdit[];
  /** For `allow`: the identifier to append to `.slopsquatshield` (via core's `appendToAllowlist`). */
  allowIdentifier?: string;
}

/** Whether `line` (0-based) is blank. */
function isBlank(text: string, starts: number[], line: number): boolean {
  const [s, e] = lineBounds(text, starts, line);
  return text.slice(s, e).trim() === '';
}

/**
 * Deleting the last item of a JSON object or TOML array leaves the previous item with a
 * dangling comma, which is a syntax error in JSON. This finds that previous line so the
 * caller can strip its comma — only when the removed lines held the final entry.
 */
function danglingCommaEdit(
  text: string,
  starts: number[],
  startLine: number,
  endLine: number,
): TextEdit | undefined {
  let prev = startLine - 1;
  while (prev >= 0 && isBlank(text, starts, prev)) prev--;
  let next = endLine + 1;
  while (next < starts.length && isBlank(text, starts, next)) next++;
  if (prev < 0 || next >= starts.length) return undefined;

  const [ps, pe] = lineBounds(text, starts, prev);
  const [ns, ne] = lineBounds(text, starts, next);
  const prevText = text.slice(ps, pe);
  const nextText = text.slice(ns, ne).trimStart();
  const [rs, re] = lineBounds(text, starts, endLine);
  const removedLastHasComma = text.slice(rs, re).trimEnd().endsWith(',');

  // The removed entry was last in its container iff the next thing is a closer and it carried no comma.
  const closesContainer = nextText.startsWith('}') || nextText.startsWith(']');
  if (!closesContainer || removedLastHasComma || !prevText.trimEnd().endsWith(','))
    return undefined;

  const commaAt = ps + prevText.trimEnd().length - 1;
  const lineIdx = starts.findIndex(
    (s, i) => s <= commaAt && (starts[i + 1] ?? Number.POSITIVE_INFINITY) > commaAt,
  );
  const character = commaAt - starts[lineIdx];
  return {
    range: {
      start: { line: lineIdx, character },
      end: { line: lineIdx, character: character + 1 },
    },
    newText: '',
  };
}

/**
 * The text to put where the identifier was. A package.json key's range includes its surrounding
 * quotes (so the squiggle covers `"left-pad"`), and replacing it with a bare name would break the
 * JSON — so keep the quotes whenever the original had them.
 */
function replacementFor(finding: Finding, text: string, replacement: string): string {
  const { start, end } = finding.range;
  if (start.line !== end.line) return replacement;
  const line = text.split('\n')[start.line] ?? '';
  const original = line.slice(start.character, end.character);
  return original.length >= 2 && original.startsWith('"') && original.endsWith('"')
    ? `"${replacement}"`
    : replacement;
}

/**
 * FR-19.2's three quick-fixes for one finding — remove the dependency, add it to the
 * allowlist, or "did you mean X". They are offered only where they make sense: nothing for a
 * parse error or an unreachable registry (not findings about a package), and did-you-mean only
 * when a look-alike signal fired — or a missing name turned out to be a typo of a popular one —
 * *and* produced a suggestion (and not for Maven, whose coordinates are `group:artifact` and
 * can't be replaced by a bare range edit).
 */
export function quickFixesFor(finding: Finding, text: string): QuickFix[] {
  if (finding.kind !== 'block' && finding.kind !== 'warn') return [];
  const fixes: QuickFix[] = [];

  if (
    finding.suggestion &&
    (finding.signals.includes('name-similarity') || finding.signals.includes('non-existence')) &&
    finding.ecosystem !== 'maven'
  ) {
    fixes.push({
      kind: 'did-you-mean',
      title: `Did you mean "${finding.suggestion}"?`,
      edits: [{ range: finding.range, newText: replacementFor(finding, text, finding.suggestion) }],
    });
  }

  if (finding.removeLines) {
    const starts = lineStarts(text);
    const { startLine, endLine } = finding.removeLines;
    const edits: TextEdit[] = [
      {
        // Whole lines including the terminator: start of startLine to start of the line after.
        range: {
          start: { line: startLine, character: 0 },
          end:
            endLine + 1 < starts.length
              ? { line: endLine + 1, character: 0 }
              : {
                  line: endLine,
                  character: lineBounds(text, starts, endLine)[1] - starts[endLine],
                },
        },
        newText: '',
      },
    ];
    const comma = danglingCommaEdit(text, starts, startLine, endLine);
    if (comma) edits.push(comma);
    fixes.push({
      kind: 'remove',
      title: `Remove "${finding.identifier}" from this manifest`,
      edits,
    });
  }

  fixes.push({
    kind: 'allow',
    title: `Add "${finding.identifier}" to .slopsquatshield (suppress this finding)`,
    allowIdentifier: finding.identifier,
  });

  return fixes;
}
