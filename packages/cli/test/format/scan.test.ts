// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join, sep } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { CREDIT, ManifestParseError, type Verdict } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import type { ScanReport } from '../../src/commands/scan.js';
import { formatScanReport } from '../../src/format/scan.js';
import { createStyle, plainStyle } from '../../src/format/style.js';

const verdict = (id: string, over: Partial<Verdict> = {}): Verdict => ({
  identifier: id,
  ecosystem: 'npm',
  tier: 'BLOCK',
  signals: [{ type: 'non-existence', reason: 'Does not exist on the npm registry.' }],
  reason: 'Does not exist on the npm registry.',
  ...over,
});

const report = (verdicts: Verdict[], over: Partial<ScanReport> = {}): ScanReport =>
  ({
    verdicts,
    unreachable: [],
    exitCode: 2,
    scannedCount: verdicts.length,
    manifestErrors: [],
    sourcesByKey: new Map(
      verdicts.map((v) => [`${v.ecosystem}:${v.identifier}`, ['package.json [dependencies]']]),
    ),
    ...over,
  }) as ScanReport;

const plain = (r: ScanReport, width = 80) =>
  formatScanReport(r, { style: plainStyle({ width }), credit: false });

describe('formatScanReport', () => {
  it('lists each finding with its name, ecosystem and source, and the reason beneath', () => {
    expect(
      plain(report([verdict('zz-ghost')]))
        .split('\n')
        .slice(0, 2),
    ).toEqual([
      '✗ zz-ghost  npm · package.json [dependencies]',
      '    Does not exist on the npm registry.',
    ]);
  });

  it('puts BLOCK before WARN before not verified, whatever order the scan returned', () => {
    const out = plain(
      report(
        [
          verdict('warned', {
            tier: 'WARN',
            reason: 'No source repository listed in the registry.',
          }),
          verdict('blocked'),
        ],
        {
          unreachable: [
            { identifier: 'unknown', ecosystem: 'pypi', error: 'connect ECONNREFUSED' },
          ],
        },
      ),
    );
    const order = ['✗ blocked', '! warned', '? unknown'].map((m) => out.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain('    Not verified: connection refused.');
  });

  it('never truncates a name, however long, and fits the reason to the terminal', () => {
    const long = 'com.example.some-organisation:a-really-quite-long-artifact-identifier';
    const reason =
      'Only 12 downloads a week (threshold: 500). Looks like the popular "lodash" (2 characters different). No source repository listed in the registry.';
    const out = plain(report([verdict(long, { ecosystem: 'maven', reason })]), 60);

    expect(out).toContain(long);
    for (const line of out.split('\n').slice(1, -2)) expect(line.length).toBeLessThanOrEqual(60);
    expect(out.replace(/\s+/g, ' ')).toContain(reason);
  });

  it('moves the ecosystem and source to their own line when the heading would not fit', () => {
    const lines = plain(report([verdict('a-fairly-long-package-name')]), 40).split('\n');
    expect(lines.slice(0, 3)).toEqual([
      '✗ a-fairly-long-package-name',
      '    npm · package.json [dependencies]',
      '    Does not exist on the npm registry.',
    ]);
  });

  it('lines names up in a column', () => {
    const lines = plain(report([verdict('a'), verdict('much-longer')])).split('\n');
    expect(lines[0]).toBe('✗ a            npm · package.json [dependencies]');
    expect(lines[2]).toBe('✗ much-longer  npm · package.json [dependencies]');
  });

  it('ends with a summary and what to do next', () => {
    const out = plain(report([verdict('a'), verdict('b', { tier: 'WARN' })]));
    expect(out).toContain('2 packages checked: 1 blocked, 1 warning.');
    expect(out).toContain('Next: fix or remove the package, or run `slopsquatshield allow <name>`');
  });

  it('says a clean scan is clean, in one line', () => {
    expect(plain(report([], { scannedCount: 9, exitCode: 0 }))).toBe(
      '✓ 9 packages checked: no findings.',
    );
  });

  it('says "not verified" is not a finding, and how to finish the check', () => {
    const out = plain(
      report([], {
        scannedCount: 1,
        exitCode: 3,
        unreachable: [{ identifier: 'x', ecosystem: 'npm', error: 'getaddrinfo ENOTFOUND x' }],
      }),
    );
    expect(out).toContain('1 package checked: 1 not verified.');
    expect(out).toContain('re-run when the registry is reachable');
    expect(out).not.toContain('Next: fix');
  });

  it('leaves out the next steps when the caller prints its own (pre-commit)', () => {
    const out = formatScanReport(report([verdict('a')]), {
      style: plainStyle(),
      credit: false,
      next: false,
    });
    expect(out).not.toContain('Next:');
  });

  it('shows manifest errors as file:line:column, with paths made readable', () => {
    const home = join(sep, 'home', 'me');
    const cwd = join(home, 'proj');
    const out = formatScanReport(
      report([], {
        exitCode: 3,
        manifestErrors: [new ManifestParseError(join(cwd, 'package.json'), 4, 3, 'bad JSON')],
      }),
      { style: plainStyle(), credit: false, paths: { cwd, home } },
    );
    expect(out).toContain('Could not read 1 manifest, so it was not checked:');
    expect(out).toContain('  package.json:4:3: bad JSON');
    expect(out).toContain('0 packages checked: 1 manifest skipped.');
  });

  it('shows source paths relative to where you are (pre-commit passes absolute ones)', () => {
    const home = join(sep, 'home', 'me');
    const cwd = join(home, 'proj');
    const r = report([verdict('a')], {
      sourcesByKey: new Map([
        ['npm:a', [`${join(cwd, 'apps', 'web', 'package.json')} [dependencies]`]],
      ]),
    });
    const out = formatScanReport(r, { style: plainStyle(), credit: false, paths: { cwd, home } });
    expect(out.split('\n')[0]).toBe(
      `✗ a  npm · ${join('apps', 'web', 'package.json')} [dependencies]`,
    );
  });

  it('keeps the report-only line', () => {
    expect(
      formatScanReport(report([verdict('a')]), { reportOnly: true, style: plainStyle() }),
    ).toContain('Report-only: exiting 0 (a normal scan would have exited 2).');
  });

  it('ends with the credit on a terminal only', () => {
    const tty = formatScanReport(report([]), { style: plainStyle({ tty: true }) }).split('\n');
    expect(tty.at(-1)).toBe(CREDIT);
    expect(formatScanReport(report([]), { style: plainStyle() })).not.toContain(CREDIT);
    expect(
      formatScanReport(report([]), { style: plainStyle({ tty: true }), credit: false }),
    ).not.toContain(CREDIT);
  });

  it('writes no escape codes when output is piped, and colours on a terminal', () => {
    const r = report([verdict('a'), verdict('b', { tier: 'WARN' })], {
      unreachable: [{ identifier: 'c', ecosystem: 'npm', error: 'boom' }],
    });
    expect(
      formatScanReport(r, { style: createStyle({ isTTY: false }, {}, 'linux') }),
    ).not.toContain('\x1b[');
    const colored = formatScanReport(r, { style: createStyle({ isTTY: true }, {}, 'linux') });
    expect(colored).toContain('\x1b[');
    expect(stripVTControlCharacters(colored)).toContain('✗ a');
  });

  it('uses ASCII marks where Unicode is not safe', () => {
    const style = createStyle({ isTTY: false }, {}, 'win32');
    expect(formatScanReport(report([verdict('a')]), { style }).split('\n')[0]).toMatch(/^x a /);
  });
});
