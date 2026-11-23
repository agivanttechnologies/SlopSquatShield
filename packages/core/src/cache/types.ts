// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Ecosystem } from '../extractors/types.js';

export type CacheFactType = 'existence' | 'popularity';

export interface CacheTtls {
  existence: number;
  popularity: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** FR-7.2's ranges are 7–30 days (existence) and 24–72h (popularity); these are the
 * mid-range defaults used when a caller doesn't override them. */
export const DEFAULT_CACHE_TTLS: CacheTtls = {
  existence: 14 * DAY_MS,
  popularity: 48 * HOUR_MS,
};

/**
 * What the engine needs from a registry-fact cache. `RegistryCache` (SQLite, the CLI/hook
 * surfaces) and `MemoryCache` (the editor extension, where a native SQLite module can't be
 * shipped to every Electron host) both satisfy it, so `resolveVerdict` never cares which.
 */
export interface FactCache {
  /** Returns the cached value, or `undefined` on a miss or an expired entry. */
  get<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType): T | undefined;
  set<T>(ecosystem: Ecosystem, name: string, factType: CacheFactType, value: T): void;
  close(): void;
}
