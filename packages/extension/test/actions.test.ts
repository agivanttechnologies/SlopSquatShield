// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { quickFixesFor } from '../src/actions.js';
import type { Finding } from '../src/findings.js';
import { locateDependency } from '../src/locate.js';
import type { TextEdit } from '../src/text.js';

/** Applies LSP-style edits to `text` (later positions first so earlier offsets stay valid). */
function apply(text: string, edits: TextEdit[]): string {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const off = (p: { line: number; character: number }) => starts[p.line] + p.character;
  return [...edits]
    .sort((a, b) => off(b.range.start) - off(a.range.start))
    .reduce((t, e) => t.slice(0, off(e.range.start)) + e.newText + t.slice(off(e.range.end)), text);
}

function finding(
  fileName: string,
  text: string,
  identifier: string,
  extra: Partial<Finding> = {},
): Finding {
  const loc = locateDependency(fileName, text, identifier);
  if (!loc) throw new Error(`fixture does not declare ${identifier}`);
  return {
    fileName,
    identifier,
    ecosystem: 'npm',
    kind: 'block',
    severity: 'error',
    message: 'm',
    range: loc.range,
    signals: [],
    removeLines: loc.lines,
    ...extra,
  };
}

const PKG = `{
  "dependencies": {
    "a": "1",
    "b": "2",
    "c": "3"
  }
}
`;

const removeEdits = (f: Finding, text: string) =>
  quickFixesFor(f, text).find((x) => x.kind === 'remove')?.edits ?? [];

describe('quickFixesFor', () => {
  it('offers remove + allow for a BLOCK, in that order, and no did-you-mean without a similarity signal', () => {
    const fixes = quickFixesFor(finding('package.json', PKG, 'b'), PKG);
    expect(fixes.map((f) => f.kind)).toEqual(['remove', 'allow']);
    expect(fixes[1].allowIdentifier).toBe('b');
  });

  it('did-you-mean is offered only when the name-similarity signal fired with a suggestion (FR-19.2)', () => {
    const base = finding('package.json', PKG, 'a', { kind: 'warn', severity: 'warning' });
    const similar = { ...base, signals: ['name-similarity' as const], suggestion: 'lodash' };
    const offered = (f: Finding) => quickFixesFor(f, PKG).some((x) => x.kind === 'did-you-mean');

    expect(offered(base)).toBe(false);
    expect(offered({ ...base, suggestion: 'lodash' })).toBe(false); // suggestion alone is not enough
    expect(offered({ ...base, signals: ['name-similarity'] })).toBe(false); // nor is the signal alone

    const fix = quickFixesFor(similar, PKG).find((x) => x.kind === 'did-you-mean');
    expect(fix?.title).toBe('Did you mean "lodash"?');
    expect(apply(PKG, fix?.edits ?? [])).toContain('"lodash": "1"');
  });

  it('never offers did-you-mean for Maven coordinates', () => {
    const pom =
      '<project><dependencies>\n<dependency>\n<groupId>g</groupId>\n<artifactId>commons-lang</artifactId>\n</dependency>\n</dependencies></project>';
    const f = finding('pom.xml', pom, 'g:commons-lang', {
      ecosystem: 'maven',
      signals: ['name-similarity'],
      suggestion: 'org.apache.commons:commons-lang3',
    });
    expect(quickFixesFor(f, pom).some((x) => x.kind === 'did-you-mean')).toBe(false);
  });

  it('offers nothing for a parse error or an unreachable registry (not findings about a package)', () => {
    for (const kind of ['unreachable', 'parse-error'] as const) {
      expect(quickFixesFor({ ...finding('package.json', PKG, 'a'), kind }, PKG)).toEqual([]);
    }
  });

  describe('remove dependency', () => {
    it('removes a middle JSON entry as a whole line, leaving valid JSON', () => {
      const out = apply(PKG, removeEdits(finding('package.json', PKG, 'b'), PKG));
      expect(JSON.parse(out).dependencies).toEqual({ a: '1', c: '3' });
    });

    it('removing the LAST JSON entry also drops the previous entry’s trailing comma', () => {
      const out = apply(PKG, removeEdits(finding('package.json', PKG, 'c'), PKG));
      expect(() => JSON.parse(out)).not.toThrow();
      expect(JSON.parse(out).dependencies).toEqual({ a: '1', b: '2' });
    });

    it('removing the only JSON entry leaves an empty, valid object', () => {
      const text = '{\n  "dependencies": {\n    "a": "1"\n  }\n}\n';
      const out = apply(text, removeEdits(finding('package.json', text, 'a'), text));
      expect(JSON.parse(out).dependencies).toEqual({});
    });

    it('removes a requirements.txt line, including the final line without a trailing newline', () => {
      const req = 'flask\nrequests==2.0\nnumpy';
      const py = { ecosystem: 'pypi' as const };
      const mid = removeEdits(finding('requirements.txt', req, 'requests', py), req);
      expect(apply(req, mid)).toBe('flask\nnumpy');
      const last = removeEdits(finding('requirements.txt', req, 'numpy', py), req);
      expect(apply(req, last)).toBe('flask\nrequests==2.0\n');
    });

    it('removes a pyproject array item and fixes the comma only when it was the last', () => {
      const toml = '[project]\ndependencies = [\n  "requests>=2",\n  "numpy"\n]\n';
      const edits = removeEdits(
        finding('pyproject.toml', toml, 'numpy', { ecosystem: 'pypi' }),
        toml,
      );
      expect(apply(toml, edits)).toBe('[project]\ndependencies = [\n  "requests>=2"\n]\n');
    });

    it('removes a whole <dependency> block from a POM', () => {
      const pom =
        '<project>\n  <dependencies>\n    <dependency>\n      <groupId>g</groupId>\n      <artifactId>a</artifactId>\n    </dependency>\n  </dependencies>\n</project>\n';
      const edits = removeEdits(finding('pom.xml', pom, 'g:a', { ecosystem: 'maven' }), pom);
      expect(apply(pom, edits)).toBe(
        '<project>\n  <dependencies>\n  </dependencies>\n</project>\n',
      );
    });

    it('is not offered when the declaration shares its line with other content', () => {
      const text = '{ "dependencies": { "a": "1", "b": "2" } }';
      expect(quickFixesFor(finding('package.json', text, 'a'), text).map((x) => x.kind)).toEqual([
        'allow',
      ]);
    });
  });
});
