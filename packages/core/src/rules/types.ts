// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Ecosystem } from '../extractors/types.js';

/**
 * Normalized package facts the rule engine evaluates (FR-4) — deliberately source-agnostic:
 * whichever of deps.dev/native-registry/Maven Central/lockfile answered doesn't matter here,
 * only the resolved facts do. `weeklyDownloads: undefined` means the popularity signal is
 * structurally unavailable (the Maven gap, FR-4's Maven note) — this is different from a
 * present-but-low count, and must never itself contribute a signal.
 */
export interface PackageFacts {
  exists: boolean;
  firstPublishedAt?: string;
  weeklyDownloads?: number;
  repoUrl?: string;
}

export type SignalType =
  | 'non-existence'
  | 'age'
  | 'popularity'
  | 'name-similarity'
  | 'missing-repo-link'
  | 'private-registry-mismatch';

export interface Signal {
  type: SignalType;
  reason: string;
  /**
   * For a `name-similarity` signal: the popular package this name is suspiciously close to —
   * what an editor's "did you mean" quick-fix offers as the replacement. Also set on a
   * `non-existence` signal when the missing name is a typo of a popular one. Absent otherwise.
   */
  suggestion?: string;
}

export type Tier = 'BLOCK' | 'WARN' | 'CLEAN';

/** NFR-6.1: every verdict carries a plain-English reason — never a bare score. */
export interface Verdict {
  identifier: string;
  ecosystem: Ecosystem;
  tier: Tier;
  signals: Signal[];
  reason: string;
  /**
   * Set when the verdict is CLEAN only because the package was *not evaluated* — the project's
   * allowlist suppressed it. Lets a surface say "allowlisted" instead of "no findings", so a
   * suppressed BLOCK is never mistaken for a clean bill of health.
   */
  suppressedBy?: 'allowlist';
  /**
   * For an install command: the manifest that declared this package when the command didn't name it
   * (a bare `npm install` reading `package.json`). Absent when the command named the package itself,
   * and for a manifest scan (which reports its own sources).
   */
  declaredIn?: string;
}

export interface RuleThresholds {
  /** FR-4 table: age < 14 days is a WARN signal. */
  minAgeDays: number;
  /** FR-4 table: < 500 weekly downloads is a WARN signal (npm/PyPI only). */
  minWeeklyDownloads: number;
  /** FR-4 table: edit-distance <= 2 from a popular package is a WARN signal. */
  maxNameSimilarityDistance: number;
}

/**
 * A package with at least this many weekly downloads is established, so the look-alike
 * (name-similarity) signal is not raised for it. A typo-squat or slopsquat does not have six-figure
 * weekly downloads, whereas ordinary tools whose names merely sit near another popular name
 * (`tsup`/`yup`, `vitest`/`vite`) do — flagging them made every install in a real project ask.
 * Only npm and PyPI report downloads, so a Maven artifact (or any package whose figure could not be
 * fetched) is never exempt.
 */
export const ESTABLISHED_WEEKLY_DOWNLOADS = 100_000;

/** FR-4.1: thresholds are configurable per-project; these are the table's defaults. */
export const DEFAULT_RULE_THRESHOLDS: RuleThresholds = {
  minAgeDays: 14,
  minWeeklyDownloads: 500,
  maxNameSimilarityDistance: 2,
};
