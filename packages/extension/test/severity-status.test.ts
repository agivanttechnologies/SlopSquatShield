// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { Finding } from '../src/findings.js';
import { exitCodeFor, severityFor } from '../src/severity.js';
import { summarize } from '../src/status.js';

const f = (kind: Finding['kind']): Finding => ({
  fileName: 'package.json',
  identifier: 'x',
  ecosystem: 'npm',
  kind,
  severity: severityFor(kind),
  message: 'm',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  signals: [],
});

describe('severityFor (FR-19.4)', () => {
  it('BLOCK → error, WARN → warning, registry-unreachable → information', () => {
    expect(severityFor('block')).toBe('error');
    expect(severityFor('warn')).toBe('warning');
    expect(severityFor('unreachable')).toBe('information');
  });

  it('never maps anything but a confirmed BLOCK to an error (NFR-3.1 fail-open)', () => {
    for (const kind of ['warn', 'unreachable', 'parse-error'] as const) {
      expect(severityFor(kind)).not.toBe('error');
    }
    expect(severityFor('parse-error')).toBe('information');
  });
});

describe('exitCodeFor — the §6 four-code scheme', () => {
  it.each([
    [[], 0],
    [['warn'], 1],
    [['block'], 2],
    [['unreachable'], 3],
    [['warn', 'unreachable'], 1],
    [['block', 'warn', 'unreachable'], 2],
    [['parse-error'], 3],
    [['warn', 'parse-error'], 1],
    [['block', 'parse-error'], 2],
  ] as const)('%j → %i', (kinds, code) => {
    expect(exitCodeFor(kinds)).toBe(code);
  });
});

describe('summarize (FR-19.3 status bar)', () => {
  it('reports clean with exit code 0', () => {
    const s = summarize([]);
    expect(s.text).toBe('$(shield) SlopSquatShield: clean');
    expect(s.exitCode).toBe(0);
  });

  it('worst tier wins the label: blocked > warnings > not verified', () => {
    expect(summarize([f('warn'), f('block'), f('block')]).text).toContain('2 blocked');
    expect(summarize([f('warn'), f('unreachable')]).text).toContain('1 warning');
    expect(summarize([f('unreachable')]).text).toContain('1 not verified');
  });

  it('maps to the shared exit codes', () => {
    expect(summarize([f('warn')]).exitCode).toBe(1);
    expect(summarize([f('block')]).exitCode).toBe(2);
    expect(summarize([f('unreachable')]).exitCode).toBe(3);
  });

  it('says scanning while work is in flight', () => {
    expect(summarize([f('block')], true).text).toContain('scanning');
  });

  it('the tooltip is plain English and labels itself advisory (never claims enforcement, §5A)', () => {
    const tip = summarize([f('block'), f('unreachable')]).tooltip;
    expect(tip).toContain('1 blocked (hallucination)');
    expect(tip).toContain('registry unreachable — not a finding');
    expect(tip).toContain('Advisory only');
  });
});
