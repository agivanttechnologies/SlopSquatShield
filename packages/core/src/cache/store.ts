// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import envPaths from 'env-paths';
import type { Ecosystem } from '../extractors/types.js';
import { type CacheFactType, type CacheTtls, DEFAULT_CACHE_TTLS, type FactCache } from './types.js';

export { DEFAULT_CACHE_TTLS, type CacheFactType, type CacheTtls };

/**
 * `better-sqlite3` is a native addon, so it is loaded the first time a `RegistryCache` is
 * actually constructed rather than at module load. That keeps it out of the import graph of
 * surfaces that never build one (the editor extension bundles core but uses `MemoryCache`),
 * so a bundle without the native module still loads.
 */
function loadDatabase(): typeof DatabaseType {
  // ESM (the dist, and the CLI bundle): `import.meta.url` exists, so build a require from it.
  // A CJS bundle (the extension): esbuild empties `import.meta`, and a real `require` exists.
  // Don't test `typeof require` first — esbuild's ESM output injects a throwing `require` shim.
  const load =
    typeof import.meta.url === 'string' && import.meta.url
      ? createRequire(import.meta.url)
      : require;
  return load('better-sqlite3') as typeof DatabaseType;
}

/** FR-7.4: standard per-OS cache dir, never inside the scanned repo. */
export function defaultCacheDbPath(): string {
  return `${envPaths('slopsquatshield').cache}/registry-cache.sqlite3`;
}

interface CacheRow {
  value: string;
  fetched_at: number;
}

/** better-sqlite3 reports a non-database / damaged file with these codes (and messages). */
function isCorruption(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT') return true;
  return err instanceof Error && /not a database|malformed|corrupt/i.test(err.message);
}

export interface RegistryCacheOptions {
  ttls?: Partial<CacheTtls>;
  now?: () => number;
  /**
   * Called when the cache had to repair itself. Defaults to one line on stderr — core never
   * prints from library code unprompted otherwise, but a silent rebuild would hide data loss.
   */
  onWarning?: (message: string) => void;
}

/**
 * Local SQLite cache for registry lookups (FR-7.1), with a distinct TTL per fact type
 * (FR-7.2): existence rarely changes once a package is published, so it's trusted far
 * longer than popularity, which drifts daily. A cache hit returns synchronously from
 * SQLite and never touches the network (FR-7.3). Ecosystem+name+fact-type is the whole
 * key — the two fact types for a given package expire independently even though a
 * registry client may have fetched them in the same call, matching FR-7.2's per-type TTL
 * rather than a single all-or-nothing expiry.
 *
 * Reliability (NFR-3.2): a cache is an optimisation, never a failure point. A corrupted
 * database file is moved aside and rebuilt empty with a warning, and a read or write that
 * fails at runtime degrades to a miss / no-op instead of crashing the scan or hook.
 */
export class RegistryCache implements FactCache {
  private readonly db: DatabaseType.Database;
  private readonly ttls: CacheTtls;
  private readonly now: () => number;
  private readonly onWarning: (message: string) => void;

  constructor(dbPath: string = defaultCacheDbPath(), options: RegistryCacheOptions = {}) {
    this.ttls = { ...DEFAULT_CACHE_TTLS, ...options.ttls };
    this.now = options.now ?? Date.now;
    this.onWarning =
      options.onWarning ?? ((message) => process.stderr.write(`slopsquatshield: ${message}\n`));

    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    this.db = this.openOrRebuild(dbPath);
  }

  private open(dbPath: string): DatabaseType.Database {
    const Database = loadDatabase();
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS cache_entries (
          ecosystem TEXT NOT NULL,
          name TEXT NOT NULL,
          fact_type TEXT NOT NULL,
          value TEXT NOT NULL,
          fetched_at INTEGER NOT NULL,
          PRIMARY KEY (ecosystem, name, fact_type)
        )
      `);
    } catch (err) {
      db.close();
      throw err;
    }
    return db;
  }

  private openOrRebuild(dbPath: string): DatabaseType.Database {
    try {
      return this.open(dbPath);
    } catch (err) {
      if (dbPath === ':memory:' || !isCorruption(err)) throw err;
      const aside = `${dbPath}.corrupt-${this.now()}`;
      try {
        renameSync(dbPath, aside);
      } catch {
        rmSync(dbPath, { force: true }); // can't keep a copy; still must not stay stuck on it
      }
      // The WAL/shared-memory sidecars belong to the damaged file — leaving them would corrupt the new one.
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
      this.onWarning(
        `the registry cache at ${dbPath} was corrupted; rebuilt it empty (old file kept at ${aside})`,
      );
      return this.open(dbPath);
    }
  }

  /** Returns the cached value, or `undefined` on a miss, an expired entry, or an unreadable one. */
  get<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType): T | undefined {
    try {
      const row = this.db
        .prepare(
          'SELECT value, fetched_at FROM cache_entries WHERE ecosystem = ? AND name = ? AND fact_type = ?',
        )
        .get(ecosystem, name, factType) as CacheRow | undefined;
      if (!row) return undefined;

      const age = this.now() - row.fetched_at;
      if (age > this.ttls[factType]) return undefined;

      return JSON.parse(row.value) as T;
    } catch {
      return undefined; // damaged row or DB: a miss just means a fresh registry lookup
    }
  }

  set<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType, value: T): void {
    try {
      this.db
        .prepare(
          `INSERT INTO cache_entries (ecosystem, name, fact_type, value, fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (ecosystem, name, fact_type)
           DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
        )
        .run(ecosystem, name, factType, JSON.stringify(value), this.now());
    } catch {
      // Read-only disk, full disk, locked DB: not caching is fine, crashing a scan is not.
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed or damaged — nothing left to release
    }
  }
}
