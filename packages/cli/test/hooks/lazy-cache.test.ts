// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LazyRegistryCache } from '../../src/hooks/lazy-cache.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssg-lazy-cache-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('LazyRegistryCache', () => {
  it('does not touch the disk until first used', () => {
    const dbPath = join(dir, 'never-created', 'cache.sqlite3');
    const cache = new LazyRegistryCache(dbPath);
    cache.close(); // closing an unopened cache is a no-op
    expect(() => rmSync(join(dir, 'never-created'))).toThrow(); // directory was never created
  });

  it('behaves as a normal cache once used', () => {
    const cache = new LazyRegistryCache(':memory:');
    expect(cache.get('npm', 'x', 'existence')).toBeUndefined();
    cache.set('npm', 'x', 'existence', { exists: true });
    expect(cache.get('npm', 'x', 'existence')).toEqual({ exists: true });
    cache.close();
  });

  it('degrades to "no cache" instead of throwing when the cache cannot be opened, warning once', () => {
    // A *file* where the cache directory should be makes opening impossible (ENOTDIR).
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const cache = new LazyRegistryCache(join(blocker, 'cache.sqlite3'));
      expect(cache.get('npm', 'x', 'existence')).toBeUndefined();
      expect(() => cache.set('npm', 'x', 'existence', { exists: true })).not.toThrow();
      expect(cache.get('npm', 'x', 'existence')).toBeUndefined();

      const warnings = stderr.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('cache unavailable'));
      expect(warnings).toHaveLength(1);
    } finally {
      stderr.mockRestore();
    }
  });
});
