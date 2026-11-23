// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import {
  type CacheFactType,
  type Ecosystem,
  type FactCache,
  RegistryCache,
} from '@slopsquatshield/core';

/**
 * A `FactCache` that opens the SQLite database only on first use. Most hook calls aren't
 * installs (`ls`, `git status`, …) and never touch the cache, so deferring it skips loading the
 * native module and opening the DB — part of keeping a per-tool-call process under the
 * latency budget (NFR-2.2).
 */
export class LazyRegistryCache implements FactCache {
  private cache: RegistryCache | undefined;
  private unavailable = false;

  constructor(private readonly dbPath?: string) {}

  /**
   * Opens on first use. If the cache can't be opened at all (native module missing, unwritable
   * directory), run without one — every lookup is then a miss — and say so once on stderr. A
   * cache is an optimisation; it must never stop a hook or a scan (NFR-3.1/3.2).
   */
  private open(): RegistryCache | undefined {
    if (this.unavailable) return undefined;
    if (!this.cache) {
      try {
        this.cache = new RegistryCache(this.dbPath);
      } catch (err) {
        this.unavailable = true;
        process.stderr.write(
          `slopsquatshield: registry cache unavailable, continuing without it — ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return undefined;
      }
    }
    return this.cache;
  }

  get<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType): T | undefined {
    return this.open()?.get<T>(ecosystem, name, factType);
  }

  set<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType, value: T): void {
    this.open()?.set(ecosystem, name, factType, value);
  }

  close(): void {
    this.cache?.close();
    this.cache = undefined;
  }
}
