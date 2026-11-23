// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { type Range, lineBounds, lineStarts, rangeOf } from './text.js';

/**
 * Where a dependency is declared in a manifest's text. The core extractors return names and a
 * source label but no positions, and an editor needs a range to put a squiggle under — so this
 * finds it by reading the document text. It locates; it never decides anything about a package.
 */
export interface Location {
  /** The identifier's own span — where the diagnostic squiggle goes. */
  range: Range;
  /**
   * Whole line(s) holding this declaration, line terminator included — what "remove dependency"
   * deletes. `undefined` when the declaration can't be removed safely as whole lines (e.g. two
   * entries sharing a line), in which case no remove fix is offered.
   */
  lines?: { startLine: number; endLine: number };
}

/** PEP 503 normalisation: `Foo_Bar.baz` and `foo-bar-baz` are the same Python package. */
function normalizePy(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Offset ranges of the `{ ... }` bodies of the named top-level-ish JSON sections. */
function jsonSectionBodies(text: string, names: string[]): Array<[number, number]> {
  const bodies: Array<[number, number]> = [];
  const re = new RegExp(`"(?:${names.map(escapeRe).join('|')})"\\s*:\\s*\\{`, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let inString = false;
    for (let i = open; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          bodies.push([open, i]);
          break;
        }
      }
    }
  }
  return bodies;
}

function lineOfOffset(starts: number[], offset: number): number {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
  return line;
}

const NPM_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function locateNpm(text: string, name: string): Location | undefined {
  const starts = lineStarts(text);
  const keyRe = new RegExp(`"${escapeRe(name)}"\\s*:`);
  for (const [open, close] of jsonSectionBodies(text, NPM_SECTIONS)) {
    const body = text.slice(open, close);
    const m = keyRe.exec(body);
    if (!m) continue;
    const start = open + m.index;
    const end = start + name.length + 2; // the quoted key
    const line = lineOfOffset(starts, start);
    const [ls, le] = lineBounds(text, starts, line);
    // Removable as whole lines only when this entry is the sole content of its line.
    const entryOnItsOwnLine =
      text.slice(ls, start).trim() === '' && /^[^{}]*$/.test(text.slice(start, le));
    return {
      range: rangeOf(starts, start, end),
      lines: entryOnItsOwnLine ? { startLine: line, endLine: line } : undefined,
    };
  }
  return undefined;
}

function locateRequirements(text: string, name: string): Location | undefined {
  const starts = lineStarts(text);
  const wanted = normalizePy(name);
  for (let line = 0; line < starts.length; line++) {
    const [ls, le] = lineBounds(text, starts, line);
    const raw = text.slice(ls, le);
    const m = /^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(raw);
    if (!m || raw.trimStart().startsWith('#') || raw.trimStart().startsWith('-')) continue;
    if (normalizePy(m[2]) !== wanted) continue;
    const start = ls + m[1].length;
    return {
      range: rangeOf(starts, start, start + m[2].length),
      lines: { startLine: line, endLine: line },
    };
  }
  return undefined;
}

/** pyproject.toml (PEP 621 array items, Poetry `name = ...` keys) and Pipfile (`name = ...`). */
function locateToml(text: string, name: string): Location | undefined {
  const starts = lineStarts(text);
  const wanted = normalizePy(name);
  for (let line = 0; line < starts.length; line++) {
    const [ls, le] = lineBounds(text, starts, line);
    const raw = text.slice(ls, le);
    // A PEP 621 item:  "requests[socks]>=2" ,   or a key:  requests = "^2"  /  "requests" = {...}
    const item = /^(\s*)(["'])([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(raw);
    const key = /^(\s*)(["']?)([A-Za-z0-9][A-Za-z0-9._-]*)\2\s*=/.exec(raw);
    const hit = item ?? key;
    if (!hit) continue;
    const [, indent, quote, found] = hit;
    if (normalizePy(found) !== wanted) continue;
    // Skip table headers' own keys that merely look like deps (e.g. python = "^3.11").
    if (found.toLowerCase() === 'python' && key) continue;
    const start = ls + indent.length + quote.length;
    return {
      range: rangeOf(starts, start, start + found.length),
      lines: { startLine: line, endLine: line },
    };
  }
  return undefined;
}

function locatePom(text: string, coordinate: string): Location | undefined {
  const [groupId, artifactId] = coordinate.split(':');
  const starts = lineStarts(text);
  const blockRe = /<dependency>[\s\S]*?<\/dependency>/g;
  for (let m = blockRe.exec(text); m; m = blockRe.exec(text)) {
    const g = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(m[0]);
    const a = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(m[0]);
    if (g?.[1] !== groupId || a?.[1] !== artifactId) continue;
    const aStart = m.index + (a?.index ?? 0) + a[0].indexOf(artifactId);
    const blockStart = m.index;
    const blockEnd = m.index + m[0].length;
    const startLine = rangeOf(starts, blockStart, blockStart).start.line;
    const endLine = rangeOf(starts, blockEnd, blockEnd).start.line;
    const [sl] = lineBounds(text, starts, startLine);
    const [, el] = lineBounds(text, starts, endLine);
    // Whole-line removal only if nothing else shares the block's first/last lines.
    const clean =
      text.slice(sl, blockStart).trim() === '' && text.slice(blockEnd, el).trim() === '';
    return {
      range: rangeOf(starts, aStart, aStart + artifactId.length),
      lines: clean ? { startLine, endLine } : undefined,
    };
  }
  return undefined;
}

/**
 * Finds `identifier` in the manifest `fileName`'s `text`. Returns `undefined` when it can't be
 * located (the file changed since the scan, or an exotic layout) — callers then skip the
 * diagnostic's precise range rather than guess.
 */
export function locateDependency(
  fileName: string,
  text: string,
  identifier: string,
): Location | undefined {
  switch (baseName(fileName)) {
    case 'package.json':
      return locateNpm(text, identifier);
    case 'requirements.txt':
      return locateRequirements(text, identifier);
    case 'pyproject.toml':
    case 'Pipfile':
      return locateToml(text, identifier);
    case 'pom.xml':
      return locatePom(text, identifier);
    default:
      return undefined;
  }
}
