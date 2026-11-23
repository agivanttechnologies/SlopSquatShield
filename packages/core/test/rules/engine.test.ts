// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { evaluatePackage } from '../../src/rules/engine.js';
import { ESTABLISHED_WEEKLY_DOWNLOADS } from '../../src/rules/types.js';

const NOW = () => new Date('2026-09-17T00:00:00Z');

describe('evaluatePackage', () => {
  it('BLOCKs on non-existence alone, with no other checks performed', () => {
    const verdict = evaluatePackage(
      'definitely-hallucinated',
      'npm',
      { exists: false },
      { now: NOW },
    );

    expect(verdict.tier).toBe('BLOCK');
    expect(verdict.signals).toEqual([
      {
        type: 'non-existence',
        reason: 'Does not exist on the npm registry.',
      },
    ]);
    expect(verdict.reason).toBe('Does not exist on the npm registry.');
  });

  it('is CLEAN when the package exists, is old, popular, has a repo link, and matches nothing', () => {
    const verdict = evaluatePackage(
      'express',
      'npm',
      {
        exists: true,
        firstPublishedAt: '2010-01-01T00:00:00Z',
        weeklyDownloads: 25_000_000,
        repoUrl: 'https://github.com/expressjs/express',
      },
      { now: NOW },
    );

    expect(verdict.tier).toBe('CLEAN');
    expect(verdict.signals).toEqual([]);
  });

  it('WARNs (not BLOCKs) when exactly one signal fires — age alone', () => {
    const verdict = evaluatePackage(
      'freshly-published',
      'npm',
      {
        exists: true,
        firstPublishedAt: '2026-09-15T00:00:00Z', // 2 days old
        weeklyDownloads: 10_000,
        repoUrl: 'https://github.com/example/freshly-published',
      },
      { now: NOW },
    );

    expect(verdict.tier).toBe('WARN');
    expect(verdict.signals).toHaveLength(1);
    expect(verdict.signals[0].type).toBe('age');
  });

  it('escalates to BLOCK once 2 signals combine — age + missing repo link', () => {
    const verdict = evaluatePackage(
      'freshly-published-no-repo',
      'npm',
      {
        exists: true,
        firstPublishedAt: '2026-09-15T00:00:00Z',
        weeklyDownloads: 10_000,
      },
      { now: NOW },
    );

    expect(verdict.tier).toBe('BLOCK');
    expect(verdict.signals.map((s) => s.type).sort()).toEqual(['age', 'missing-repo-link']);
  });

  it('flags popularity below threshold as its own WARN signal', () => {
    const verdict = evaluatePackage(
      'niche-lib',
      'npm',
      {
        exists: true,
        firstPublishedAt: '2020-01-01T00:00:00Z',
        weeklyDownloads: 12,
        repoUrl: 'https://github.com/example/niche-lib',
      },
      { now: NOW },
    );

    expect(verdict.tier).toBe('WARN');
    expect(verdict.signals).toEqual([
      { type: 'popularity', reason: 'Only 12 downloads a week (threshold: 500).' },
    ]);
  });

  it('never fires a popularity signal when weeklyDownloads is undefined (the Maven gap)', () => {
    const verdict = evaluatePackage(
      'org.apache.commons:commons-lang3',
      'maven',
      {
        exists: true,
        firstPublishedAt: '2005-01-01T00:00:00Z',
        repoUrl: 'https://github.com/apache/commons-lang',
        // weeklyDownloads intentionally omitted — Maven has no downloads metric at all
      },
      { now: NOW },
    );

    expect(verdict.tier).toBe('CLEAN');
    expect(verdict.signals.some((s) => s.type === 'popularity')).toBe(false);
  });

  it('flags name-similarity against the popular-package reference list, excluding an exact match', () => {
    const verdict = evaluatePackage(
      'lodahs',
      'npm',
      {
        exists: true,
        firstPublishedAt: '2020-01-01T00:00:00Z',
        weeklyDownloads: 5,
        repoUrl: undefined,
      },
      { now: NOW, popularPackages: ['lodash', 'react', 'express'] },
    );

    expect(verdict.signals.find((s) => s.type === 'name-similarity')).toEqual({
      type: 'name-similarity',
      reason: 'Looks like the popular "lodash" (2 characters different).',
      // The replacement an editor's "did you mean" quick-fix offers — only this signal carries one.
      suggestion: 'lodash',
    });
  });

  it('never flags name-similarity for a package that IS the popular one (exact match, distance 0)', () => {
    const verdict = evaluatePackage(
      'lodash',
      'npm',
      { exists: true, firstPublishedAt: '2020-01-01T00:00:00Z', weeklyDownloads: 999_999 },
      { now: NOW, popularPackages: ['lodash', 'react'] },
    );

    expect(verdict.signals.some((s) => s.type === 'name-similarity')).toBe(false);
  });

  describe('the look-alike signal is not raised for an established package', () => {
    const lookalike = (weeklyDownloads: number | undefined, ecosystem: 'npm' | 'maven' = 'npm') =>
      evaluatePackage(
        'tsup',
        ecosystem,
        { exists: true, firstPublishedAt: '2020-01-01T00:00:00Z', weeklyDownloads, repoUrl: 'x' },
        { now: NOW, popularPackages: ['yup', 'react'] },
      );

    it('a package with six-figure weekly downloads is CLEAN even though its name is near a popular one', () => {
      // tsup is two edits from yup, and is a perfectly ordinary dev dependency.
      const verdict = lookalike(1_300_000);

      expect(verdict.signals.some((s) => s.type === 'name-similarity')).toBe(false);
      expect(verdict.tier).toBe('CLEAN');
    });

    it('the boundary is inclusive: exactly 100,000 is established, 99,999 is not', () => {
      expect(lookalike(ESTABLISHED_WEEKLY_DOWNLOADS).tier).toBe('CLEAN');
      expect(lookalike(ESTABLISHED_WEEKLY_DOWNLOADS - 1).tier).toBe('WARN');
    });

    it('still catches a typo-squat: modest downloads keep the signal', () => {
      const verdict = lookalike(50_000);

      expect(verdict.tier).toBe('WARN');
      expect(verdict.signals.map((s) => s.type)).toEqual(['name-similarity']);
    });

    it('still catches one that is also new and unpopular: two signals BLOCK', () => {
      const verdict = evaluatePackage(
        'lodahs',
        'npm',
        {
          exists: true,
          firstPublishedAt: '2026-09-16T00:00:00Z',
          weeklyDownloads: 42,
          repoUrl: 'x',
        },
        { now: NOW, popularPackages: ['lodash'] },
      );

      expect(verdict.tier).toBe('BLOCK');
    });

    it('is never exempt when the downloads figure is unknown (a failed lookup must not look established)', () => {
      expect(lookalike(undefined).tier).toBe('WARN');
    });

    it('is never exempt for Maven, which has no downloads at all', () => {
      expect(lookalike(undefined, 'maven').tier).toBe('WARN');
    });
  });

  describe('wording a person reads', () => {
    it('says "did you mean" when a missing name is a typo of a popular one, and carries the suggestion', () => {
      const verdict = evaluatePackage(
        'reqeusts',
        'pypi',
        { exists: false },
        { now: NOW, popularPackages: ['requests', 'numpy'] },
      );

      expect(verdict.tier).toBe('BLOCK');
      expect(verdict.reason).toBe('Does not exist on PyPI. Did you mean "requests"?');
      expect(verdict.signals[0]).toEqual({
        type: 'non-existence',
        reason: 'Does not exist on PyPI. Did you mean "requests"?',
        suggestion: 'requests',
      });
    });

    it('does not guess when nothing popular is close', () => {
      const verdict = evaluatePackage(
        'zz-ghost-93817',
        'npm',
        { exists: false },
        { now: NOW, popularPackages: ['lodash', 'express'] },
      );

      expect(verdict.signals[0]).toEqual({
        type: 'non-existence',
        reason: 'Does not exist on the npm registry.',
      });
    });

    it.each([
      ['npm', 'Does not exist on the npm registry.'],
      ['pypi', 'Does not exist on PyPI.'],
      ['maven', 'Does not exist on Maven Central.'],
    ] as const)('names %s the way a person would', (ecosystem, phrase) => {
      expect(evaluatePackage('x', ecosystem, { exists: false }, { now: NOW }).reason).toContain(
        phrase,
      );
    });

    it('never repeats the name or the tier: every surface shows those itself', () => {
      const verdict = evaluatePackage('lodahs', 'npm', { exists: false }, { now: NOW });
      expect(verdict.reason).not.toContain('lodahs');
      expect(verdict.reason).not.toMatch(/BLOCK|WARN/);
    });

    it('says how old a new package is in whole days, and "less than a day" under one', () => {
      const facts = (iso: string) => ({ exists: true, firstPublishedAt: iso, repoUrl: 'x' });
      const day = 24 * 60 * 60 * 1000;
      const ago = (ms: number) => new Date(NOW().getTime() - ms).toISOString();
      expect(evaluatePackage('a', 'maven', facts(ago(day / 2)), { now: NOW }).reason).toBe(
        'Published less than a day ago (threshold: 14 days).',
      );
      expect(evaluatePackage('a', 'maven', facts(ago(1.5 * day)), { now: NOW }).reason).toBe(
        'Published 1 day ago (threshold: 14 days).',
      );
      expect(evaluatePackage('a', 'maven', facts(ago(3.2 * day)), { now: NOW }).reason).toBe(
        'Published 3 days ago (threshold: 14 days).',
      );
    });

    it('writes big download counts with separators', () => {
      const verdict = evaluatePackage(
        'tiny',
        'npm',
        {
          exists: true,
          firstPublishedAt: '2020-01-01T00:00:00Z',
          weeklyDownloads: 1234,
          repoUrl: 'x',
        },
        { now: NOW, thresholds: { minWeeklyDownloads: 100_000_000_000 } },
      );

      expect(verdict.reason).toContain('Only 1,234 downloads a week (threshold: 100,000,000,000).');
    });
  });

  it('BLOCKs on private-registry mismatch alone, with a reason distinct from non-existence', () => {
    const verdict = evaluatePackage(
      '@myorg/internal-tool',
      'npm',
      { exists: true, firstPublishedAt: '2020-01-01T00:00:00Z', weeklyDownloads: 999_999 },
      { now: NOW, privateScope: { npmScopes: ['@myorg'] } },
    );

    expect(verdict.tier).toBe('BLOCK');
    expect(verdict.signals).toEqual([
      {
        type: 'private-registry-mismatch',
        reason:
          "Matches this project's private naming convention (privateScopes) but is published on the public npm registry: dependency confusion, not a hallucination.",
      },
    ]);
  });

  it('respects custom thresholds (FR-4.1)', () => {
    const verdict = evaluatePackage(
      'somewhat-fresh',
      'npm',
      {
        exists: true,
        firstPublishedAt: '2026-09-10T00:00:00Z', // 7 days old
        weeklyDownloads: 999_999,
        repoUrl: 'https://github.com/example/somewhat-fresh',
      },
      { now: NOW, thresholds: { minAgeDays: 30 } },
    );

    expect(verdict.tier).toBe('WARN');
    expect(verdict.signals[0].type).toBe('age');
  });
});
