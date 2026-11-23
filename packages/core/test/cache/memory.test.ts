// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/cache/memory.js';
import { DEFAULT_CACHE_TTLS } from '../../src/cache/types.js';

describe('MemoryCache', () => {
  it('is a miss for a key that was never set', () => {
    expect(new MemoryCache().get('npm', 'express', 'existence')).toBeUndefined();
  });

  it('round-trips a set value', () => {
    const cache = new MemoryCache();
    const facts = { exists: true, firstPublishedAt: '2010-01-01T00:00:00Z' };
    cache.set('npm', 'express', 'existence', facts);
    expect(cache.get('npm', 'express', 'existence')).toEqual(facts);
  });

  it('keys ecosystem, name and fact type independently', () => {
    const cache = new MemoryCache();
    cache.set('npm', 'requests', 'existence', { exists: false });
    cache.set('pypi', 'requests', 'existence', { exists: true });
    cache.set('npm', 'requests', 'popularity', { weeklyDownloads: 5 });

    expect(cache.get('npm', 'requests', 'existence')).toEqual({ exists: false });
    expect(cache.get('pypi', 'requests', 'existence')).toEqual({ exists: true });
    expect(cache.get('npm', 'requests', 'popularity')).toEqual({ weeklyDownloads: 5 });
  });

  it('expires each fact type on its own TTL', () => {
    let now = 1_000_000;
    const cache = new MemoryCache({ now: () => now });
    cache.set('npm', 'express', 'existence', { exists: true });
    cache.set('npm', 'express', 'popularity', { weeklyDownloads: 1 });

    now += DEFAULT_CACHE_TTLS.popularity + 1;

    expect(cache.get('npm', 'express', 'popularity')).toBeUndefined();
    expect(cache.get('npm', 'express', 'existence')).toEqual({ exists: true });

    now += DEFAULT_CACHE_TTLS.existence;
    expect(cache.get('npm', 'express', 'existence')).toBeUndefined();
  });

  it('hands out copies, so a caller mutating a result cannot corrupt the cache', () => {
    const cache = new MemoryCache();
    cache.set('npm', 'x', 'existence', { exists: true });
    const first = cache.get<{ exists: boolean }>('npm', 'x', 'existence');
    if (first) first.exists = false;
    expect(cache.get('npm', 'x', 'existence')).toEqual({ exists: true });
  });

  it('stays readable after close(), so a shared instance can outlive a per-scan close', () => {
    const cache = new MemoryCache();
    cache.set('npm', 'x', 'existence', { exists: true });
    cache.close();
    expect(cache.get('npm', 'x', 'existence')).toEqual({ exists: true });
  });
});
