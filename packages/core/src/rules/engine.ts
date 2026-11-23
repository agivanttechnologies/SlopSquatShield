// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Ecosystem } from '../extractors/types.js';
import { type PrivateScopeConfig, isExpectedPrivate } from './dependency-confusion.js';
import { existsOn, formatCount, publicRegistry } from './registry-label.js';
import { findSimilarPopularPackage } from './similarity.js';
import {
  DEFAULT_RULE_THRESHOLDS,
  ESTABLISHED_WEEKLY_DOWNLOADS,
  type PackageFacts,
  type RuleThresholds,
  type Signal,
  type Verdict,
} from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EvaluateOptions {
  thresholds?: Partial<RuleThresholds>;
  /** FR-4.3's maintained top-N reference list for this ecosystem — never the full registry. */
  popularPackages?: readonly string[];
  /** FR-6.1's private-naming config; omitted or empty means dependency confusion is never checked. */
  privateScope?: PrivateScopeConfig;
  now?: () => Date;
}

function ageInDays(firstPublishedAt: string, now: Date): number {
  return (now.getTime() - new Date(firstPublishedAt).getTime()) / MS_PER_DAY;
}

/**
 * A verdict's reason: its signals' sentences, in order. It is about the package but does not repeat
 * its name or tier — every surface already shows those next to it (a table row, a squiggle, a
 * `name (ecosystem):` lead-in from `describeVerdict`), and repeating them made every line twice as long.
 */
export function buildReason(signals: Signal[]): string {
  return signals.map((s) => s.reason).join(' ');
}

/** `n` with the right plural: `1 day`, `3 days`. */
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The rule engine (FR-4): rule-based intersection-of-signals, not weighted scoring, so
 * every verdict stays auditable (NFR-6.1) — never a bare score, always the exact
 * signal(s) that fired. Two signals are BLOCK-alone and short-circuit everything else:
 * non-existence (the package was never published at all) and a private-registry-naming
 * match resolving on the public registry (dependency confusion, FR-6 — a distinct reason
 * from non-existence, since the package is real, just not supposed to be public). All
 * other signals (age, popularity, name-similarity, missing-repo-link) are WARN alone and
 * only escalate to BLOCK once 2 or more of them fire together. Maven has no popularity
 * signal at all (deps.dev/Maven Central both lack a public download-count API, FR-4's
 * documented gap), so its combinable pool is 3 signals instead of 4.
 */
export function evaluatePackage(
  identifier: string,
  ecosystem: Ecosystem,
  facts: PackageFacts,
  options: EvaluateOptions = {},
): Verdict {
  const thresholds = { ...DEFAULT_RULE_THRESHOLDS, ...options.thresholds };
  const now = (options.now ?? (() => new Date()))();

  if (!facts.exists) {
    // A name that doesn't exist but is a typo of a popular one is the commonest hallucination;
    // say what was probably meant (an editor turns this into a "did you mean" quick fix).
    const didYouMean = findSimilarPopularPackage(
      identifier,
      options.popularPackages ?? [],
      thresholds.maxNameSimilarityDistance,
    );
    const signals: Signal[] = [
      {
        type: 'non-existence',
        reason: `Does not exist on ${existsOn(ecosystem)}.${
          didYouMean ? ` Did you mean "${didYouMean.matchedName}"?` : ''
        }`,
        ...(didYouMean ? { suggestion: didYouMean.matchedName } : {}),
      },
    ];
    return {
      identifier,
      ecosystem,
      tier: 'BLOCK',
      signals,
      reason: buildReason(signals),
    };
  }

  if (options.privateScope && isExpectedPrivate(identifier, ecosystem, options.privateScope)) {
    const signals: Signal[] = [
      {
        type: 'private-registry-mismatch',
        reason: `Matches this project's private naming convention (privateScopes) but is published on the public ${publicRegistry(ecosystem)}: dependency confusion, not a hallucination.`,
      },
    ];
    return {
      identifier,
      ecosystem,
      tier: 'BLOCK',
      signals,
      reason: buildReason(signals),
    };
  }

  const signals: Signal[] = [];

  if (facts.firstPublishedAt !== undefined) {
    const days = ageInDays(facts.firstPublishedAt, now);
    if (days < thresholds.minAgeDays) {
      signals.push({
        type: 'age',
        reason: `${
          days < 1
            ? 'Published less than a day ago'
            : `Published ${plural(Math.floor(days), 'day')} ago`
        } (threshold: ${plural(thresholds.minAgeDays, 'day')}).`,
      });
    }
  }

  if (
    facts.weeklyDownloads !== undefined &&
    facts.weeklyDownloads < thresholds.minWeeklyDownloads
  ) {
    signals.push({
      type: 'popularity',
      reason: `Only ${formatCount(facts.weeklyDownloads)} downloads a week (threshold: ${formatCount(thresholds.minWeeklyDownloads)}).`,
    });
  }

  // An established package is not a look-alike trap (see ESTABLISHED_WEEKLY_DOWNLOADS).
  const established =
    facts.weeklyDownloads !== undefined && facts.weeklyDownloads >= ESTABLISHED_WEEKLY_DOWNLOADS;
  const similar = established
    ? undefined
    : findSimilarPopularPackage(
        identifier,
        options.popularPackages ?? [],
        thresholds.maxNameSimilarityDistance,
      );
  if (similar) {
    signals.push({
      type: 'name-similarity',
      reason: `Looks like the popular "${similar.matchedName}" (${plural(similar.distance, 'character')} different).`,
      suggestion: similar.matchedName,
    });
  }

  if (!facts.repoUrl) {
    signals.push({
      type: 'missing-repo-link',
      reason: 'No source repository listed in the registry.',
    });
  }

  if (signals.length === 0) {
    return { identifier, ecosystem, tier: 'CLEAN', signals, reason: 'No findings.' };
  }

  const tier = signals.length >= 2 ? 'BLOCK' : 'WARN';
  return { identifier, ecosystem, tier, signals, reason: buildReason(signals) };
}
