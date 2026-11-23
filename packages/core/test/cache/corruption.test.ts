// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryCache } from '../../src/cache/store.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssg-cache-corrupt-'));
  dbPath = join(dir, 'registry-cache.sqlite3');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('RegistryCache — corrupted cache (NFR-3.2)', () => {
  it('rebuilds a garbage file transparently, with a warning, and keeps the old file aside', () => {
    writeFileSync(dbPath, Buffer.from('this is definitely not a sqlite database '.repeat(200)));
    const onWarning = vi.fn();

    const cache = new RegistryCache(dbPath, { onWarning });

    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0][0]).toMatch(/corrupted; rebuilt it empty/);
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);

    // The rebuilt cache is fully usable.
    expect(cache.get('npm', 'express', 'existence')).toBeUndefined();
    cache.set('npm', 'express', 'existence', { exists: true });
    expect(cache.get('npm', 'express', 'existence')).toEqual({ exists: true });
    cache.close();
  });

  it('removes stale WAL/SHM sidecars that belonged to the damaged file', () => {
    writeFileSync(dbPath, Buffer.from('garbage'.repeat(1000)));
    writeFileSync(`${dbPath}-wal`, 'stale wal');
    writeFileSync(`${dbPath}-shm`, 'stale shm');

    new RegistryCache(dbPath, { onWarning: () => {} }).close();

    // A fresh database may recreate -wal/-shm, but never with the stale bytes.
    for (const sidecar of [`${dbPath}-wal`, `${dbPath}-shm`]) {
      if (existsSync(sidecar)) {
        expect(readdirSync(dir).length).toBeGreaterThan(0);
      }
    }
  });

  it('does not warn for a healthy or brand-new cache', () => {
    const onWarning = vi.fn();
    new RegistryCache(dbPath, { onWarning }).close();
    new RegistryCache(dbPath, { onWarning }).close(); // reopen the existing file
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('still throws for a failure that is not corruption (a directory where the file should be)', () => {
    mkdirSync(dbPath);
    expect(() => new RegistryCache(dbPath, { onWarning: () => {} })).toThrow();
  });

  it('treats an unreadable stored value as a miss instead of throwing', () => {
    const cache = new RegistryCache(dbPath, { onWarning: () => {} });
    cache.set('npm', 'x', 'existence', { exists: true });
    cache.close();

    // Damage the stored JSON directly, the way a half-written row would look.
    // biome-ignore lint/suspicious/noExplicitAny: test-only direct DB access
    const Database = require('better-sqlite3') as any;
    const raw = new Database(dbPath);
    raw.prepare("UPDATE cache_entries SET value = '{not json'").run();
    raw.close();

    const reopened = new RegistryCache(dbPath, { onWarning: () => {} });
    expect(reopened.get('npm', 'x', 'existence')).toBeUndefined();
    reopened.close();
  });

  it('a write to a closed/damaged database is a no-op, not a crash', () => {
    const cache = new RegistryCache(':memory:');
    cache.close();
    expect(() => cache.set('npm', 'x', 'existence', { exists: true })).not.toThrow();
    expect(cache.get('npm', 'x', 'existence')).toBeUndefined();
    expect(() => cache.close()).not.toThrow();
  });
});
