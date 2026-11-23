// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { Verdict } from '../../src/rules/types.js';
import { applyLockfilePin } from '../../src/scan/lockfile-pin.js';

const notFound = (id = 'zz-ghost'): Verdict => ({
  identifier: id,
  ecosystem: 'npm',
  tier: 'BLOCK',
  signals: [{ type: 'non-existence', reason: `${id} does not exist on the npm registry` }],
  reason: `BLOCK: ${id} — ${id} does not exist on the npm registry`,
});

describe('applyLockfilePin', () => {
  it('leaves an unpinned verdict untouched', () => {
    const v = notFound();
    expect(applyLockfilePin(v, false)).toBe(v);
  });

  it('turns "pinned but not on the public registry" into a WARN that names the lockfile', () => {
    const out = applyLockfilePin(notFound(), true);
    expect(out.tier).toBe('WARN');
    expect(out.reason).toContain('Pinned in the lockfile');
    expect(out.reason).toContain('hand-edited lockfile entry');
    expect(out.signals.map((s) => s.type)).toEqual(['non-existence']);
  });

  it('is CLEAN when the name matches a declared private scope (an expected private package)', () => {
    const out = applyLockfilePin(notFound('@acme/internal'), true, { npmScopes: ['@acme'] });
    expect(out.tier).toBe('CLEAN');
    expect(out.reason).toContain('Expected private package');
  });

  it('does not treat a non-matching name as private', () => {
    const out = applyLockfilePin(notFound('@other/thing'), true, { npmScopes: ['@acme'] });
    expect(out.tier).toBe('WARN');
  });

  it('leaves a dependency-confusion BLOCK alone: the name resolves publicly', () => {
    const confusion: Verdict = {
      identifier: '@acme/x',
      ecosystem: 'npm',
      tier: 'BLOCK',
      signals: [{ type: 'private-registry-mismatch', reason: 'resolves publicly' }],
      reason: 'BLOCK: @acme/x — resolves publicly',
    };
    expect(applyLockfilePin(confusion, true, { npmScopes: ['@acme'] })).toBe(confusion);
  });

  it('leaves WARN and CLEAN verdicts alone, so a pinned package is judged on its merits', () => {
    const warn: Verdict = {
      identifier: 'young',
      ecosystem: 'npm',
      tier: 'WARN',
      signals: [{ type: 'age', reason: 'published 1 day ago' }],
      reason: 'WARN: young — published 1 day ago',
    };
    expect(applyLockfilePin(warn, true)).toBe(warn);
  });

  it('names the registry properly in the message', () => {
    const maven: Verdict = {
      ...notFound('g:a'),
      ecosystem: 'maven',
      signals: [{ type: 'non-existence', reason: 'x' }],
    };
    expect(applyLockfilePin(maven, true).reason).toContain('Maven Central');
    const pypi: Verdict = { ...notFound('p'), ecosystem: 'pypi' };
    expect(applyLockfilePin(pypi, true).reason).toContain('PyPI');
  });
});
