// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CACHE_TTLS, RegistryCache } from '../../src/cache/store.js';

describe('RegistryCache', () => {
  let cache: RegistryCache | undefined;

  afterEach(() => {
    cache?.close();
    cache = undefined;
  });

  it('is a miss (undefined) for a key that was never set', () => {
    cache = new RegistryCache(':memory:');
    expect(cache.get('npm', 'express', 'existence')).toBeUndefined();
  });

  it('round-trips a set value through get (cache hit, zero network calls)', () => {
    cache = new RegistryCache(':memory:');
    const facts = { exists: true, firstPublishedAt: '2010-01-01T00:00:00Z' };

    cache.set('npm', 'express', 'existence', facts);

    expect(cache.get('npm', 'express', 'existence')).toEqual(facts);
  });

  it('keys existence and popularity independently for the same package', () => {
    cache = new RegistryCache(':memory:');
    cache.set('npm', 'express', 'existence', { exists: true });
    cache.set('npm', 'express', 'popularity', { weeklyDownloads: 25_000_000 });

    expect(cache.get('npm', 'express', 'existence')).toEqual({ exists: true });
    expect(cache.get('npm', 'express', 'popularity')).toEqual({ weeklyDownloads: 25_000_000 });
  });

  it('keys the same package name independently per ecosystem', () => {
    cache = new RegistryCache(':memory:');
    cache.set('npm', 'requests', 'existence', { exists: false, ecosystem: 'npm' });
    cache.set('pypi', 'requests', 'existence', { exists: true, ecosystem: 'pypi' });

    expect(cache.get('npm', 'requests', 'existence')).toEqual({ exists: false, ecosystem: 'npm' });
    expect(cache.get('pypi', 'requests', 'existence')).toEqual({ exists: true, ecosystem: 'pypi' });
  });

  it('expires an existence entry once its (longer) TTL elapses', () => {
    let clock = 0;
    cache = new RegistryCache(':memory:', { now: () => clock });

    cache.set('npm', 'express', 'existence', { exists: true });
    clock += DEFAULT_CACHE_TTLS.existence + 1;

    expect(cache.get('npm', 'express', 'existence')).toBeUndefined();
  });

  it("expires a popularity entry on its own (shorter) TTL, independent of existence's", () => {
    let clock = 0;
    cache = new RegistryCache(':memory:', { now: () => clock });

    cache.set('npm', 'express', 'existence', { exists: true });
    cache.set('npm', 'express', 'popularity', { weeklyDownloads: 1 });
    clock += DEFAULT_CACHE_TTLS.popularity + 1;

    expect(cache.get('npm', 'express', 'popularity')).toBeUndefined();
    expect(cache.get('npm', 'express', 'existence')).toEqual({ exists: true });
  });

  it('honors custom TTL overrides', () => {
    let clock = 0;
    cache = new RegistryCache(':memory:', { now: () => clock, ttls: { existence: 1000 } });

    cache.set('npm', 'express', 'existence', { exists: true });
    clock += 1001;

    expect(cache.get('npm', 'express', 'existence')).toBeUndefined();
  });

  it('answers 20 cached lookups in well under 50ms (warm re-scan stays fast)', () => {
    cache = new RegistryCache(':memory:');
    for (let i = 0; i < 20; i++) {
      cache.set('npm', `package-${i}`, 'existence', { exists: true, firstPublishedAt: 'x' });
    }

    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      cache.get('npm', `package-${i}`, 'existence');
    }
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('overwrites a value and refreshes its fetched_at on a second set', () => {
    let clock = 0;
    cache = new RegistryCache(':memory:', { now: () => clock });

    cache.set('npm', 'express', 'existence', { exists: true, version: 1 });
    clock += DEFAULT_CACHE_TTLS.existence - 1;
    cache.set('npm', 'express', 'existence', { exists: true, version: 2 });
    clock += DEFAULT_CACHE_TTLS.existence - 1;

    expect(cache.get('npm', 'express', 'existence')).toEqual({ exists: true, version: 2 });
  });
});
