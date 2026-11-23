// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Ecosystem } from '../extractors/types.js';
import { type CacheFactType, type CacheTtls, DEFAULT_CACHE_TTLS, type FactCache } from './types.js';

interface Entry {
  value: unknown;
  fetchedAt: number;
}

/**
 * In-process cache with the same per-fact-type TTLs as the SQLite one (FR-7.2). Used where
 * a native module isn't an option — the editor extension — and in tests. A long-lived
 * process (the extension host) still gets warm lookups within a session; nothing persists
 * across restarts. Values are stored by reference-free JSON round-trip so a caller mutating
 * a returned object can't corrupt the cache, matching what the SQLite store does.
 */
export class MemoryCache implements FactCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttls: CacheTtls;
  private readonly now: () => number;

  constructor(options: { ttls?: Partial<CacheTtls>; now?: () => number } = {}) {
    this.ttls = { ...DEFAULT_CACHE_TTLS, ...options.ttls };
    this.now = options.now ?? Date.now;
  }

  private key(ecosystem: Ecosystem, name: string, factType: CacheFactType): string {
    return `${ecosystem}\u0000${name}\u0000${factType}`;
  }

  get<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType): T | undefined {
    const key = this.key(ecosystem, name, factType);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.fetchedAt > this.ttls[factType]) {
      this.entries.delete(key);
      return undefined;
    }
    return JSON.parse(entry.value as string) as T;
  }

  set<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType, value: T): void {
    this.entries.set(this.key(ecosystem, name, factType), {
      value: JSON.stringify(value),
      fetchedAt: this.now(),
    });
  }

  close(): void {
    // Nothing to release; kept so MemoryCache is a drop-in FactCache. Entries stay readable
    // so a shared instance can outlive a per-scan close().
  }
}
