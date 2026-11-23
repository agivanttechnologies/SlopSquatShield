// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Verdict } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import { formatInstallReport } from '../../src/format/install.js';
import { createStyle, plainStyle } from '../../src/format/style.js';

const ghost = (id: string, over: Partial<Verdict> = {}): Verdict => ({
  identifier: id,
  ecosystem: 'npm',
  tier: 'BLOCK',
  signals: [{ type: 'non-existence', reason: 'Does not exist on the npm registry.' }],
  reason: 'Does not exist on the npm registry.',
  ...over,
});
const none = { verdicts: [], unreachable: [], notVerified: [] };
const style = plainStyle({ width: 120 });

describe('formatInstallReport', () => {
  it('says what was blocked, that nothing was installed, why, and what to do', () => {
    const out = formatInstallReport(
      'npm install zz-ghost',
      {
        ...none,
        verdicts: [ghost('zz-ghost'), ghost('from-manifest', { declaredIn: 'package.json' })],
      },
      style,
    );
    expect(out.split('\n')).toEqual([
      'slopsquatshield: blocked `npm install zz-ghost`; nothing was installed.',
      '✗ zz-ghost       npm · named in the command',
      '    Does not exist on the npm registry.',
      '✗ from-manifest  npm · declared in package.json',
      '    Does not exist on the npm registry.',
      'Next: fix or remove the package, or run `slopsquatshield allow <name>` if you are sure it is real.',
    ]);
  });

  it('never suggests a way around the wrapper (an agent in a wrapped shell reads this too)', () => {
    const out = formatInstallReport('npm i x', { ...none, verdicts: [ghost('x')] }, style);
    expect(out).not.toMatch(/command npm|bypass|\\npm|--no-verify/);
  });

  it('a WARN says it is installing anyway', () => {
    const out = formatInstallReport(
      'npm i fresh',
      {
        ...none,
        verdicts: [
          ghost('fresh', { tier: 'WARN', reason: 'Published 2 days ago (threshold: 14 days).' }),
        ],
      },
      style,
    );
    expect(out.split('\n')).toEqual([
      'slopsquatshield: warning for `npm i fresh`; installing anyway.',
      '! fresh  npm · named in the command',
      '    Published 2 days ago (threshold: 14 days).',
    ]);
  });

  it('names what could not be verified, with a short cause, and goes ahead', () => {
    const out = formatInstallReport(
      'npm i a',
      {
        ...none,
        unreachable: [
          { identifier: 'a', ecosystem: 'npm', error: 'connect ECONNREFUSED 1.2.3.4:443' },
        ],
        notVerified: ['could not parse package.json:1:3: bad JSON'],
      },
      style,
    );
    expect(out).toContain(
      'slopsquatshield: could not reach the registry to verify a (connection refused); not checked,',
    );
    expect(out).toContain(
      'slopsquatshield: could not parse package.json:1:3: bad JSON; not checked,',
    );
  });

  it('prints nothing for a clean, fully checked install', () => {
    expect(
      formatInstallReport(
        'npm i express',
        { ...none, verdicts: [ghost('express', { tier: 'CLEAN' })] },
        style,
      ),
    ).toBe('');
  });

  it('writes no escape codes when stderr is not a terminal', () => {
    const piped = createStyle({ isTTY: false }, {}, 'linux');
    expect(
      formatInstallReport('npm i x', { ...none, verdicts: [ghost('x')] }, piped),
    ).not.toContain('\x1b[');
  });
});
