// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { isAllowlisted } from '../allowlist/index.js';
import type { FactCache } from '../cache/types.js';
import type { Ecosystem } from '../extractors/types.js';
import { getDepsDevFacts } from '../registry/deps-dev.js';
import { getMavenCentralFacts } from '../registry/maven-central.js';
import { getNpmRegistryFacts, getNpmWeeklyDownloads } from '../registry/npm.js';
import { getPyPiRegistryFacts, getPyPiWeeklyDownloads } from '../registry/pypi.js';
import { type LockfileIndex, resolveViaLockfile } from '../resolvers/types.js';
import { type EvaluateOptions, evaluatePackage } from '../rules/engine.js';
import type { PackageFacts, Verdict } from '../rules/types.js';
import { applyLockfilePin } from './lockfile-pin.js';

export interface ResolveVerdictOptions extends EvaluateOptions {
  allowlist?: ReadonlySet<string>;
  lockfileIndex?: LockfileIndex;
  cache?: FactCache;
  fetchImpl?: typeof fetch;
}

export type ResolveVerdictResult =
  | { kind: 'verdict'; verdict: Verdict }
  | { kind: 'unreachable'; identifier: string; ecosystem: Ecosystem; error: string };

interface CachedExistence {
  exists: boolean;
  firstPublishedAt?: string;
  repoUrl?: string;
}
interface CachedPopularity {
  weeklyDownloads?: number;
}

/**
 * One request for the downloads figure alone. Soft-fails to `undefined`: the popularity signal is
 * omitted rather than the whole check being escalated (the same treatment as Maven's structural
 * downloads gap, FR-4). Before this, it re-fetched the package's whole record just to read it.
 */
async function fetchWeeklyDownloadsOnly(
  identifier: string,
  ecosystem: 'npm' | 'pypi',
  fetchImpl: typeof fetch | undefined,
): Promise<number | undefined> {
  return ecosystem === 'npm'
    ? getNpmWeeklyDownloads(identifier, fetchImpl)
    : getPyPiWeeklyDownloads(identifier, fetchImpl);
}

/**
 * Fetches fresh facts in FR-3.5's source order: deps.dev primary for npm/PyPI (existence,
 * age, repo link), falling all the way through to the native registry client only when
 * deps.dev itself is unreachable (FR-3.2's fallback role) — when deps.dev *does* answer,
 * the native client is still consulted, but only for weekly downloads (a signal deps.dev
 * never has), and a failure there alone is soft-omitted rather than escalated. Maven Central
 * is primary and sole source for Maven (FR-3.3) — no downloads field exists to fetch at all.
 * Throws only when every available source for this ecosystem has failed, which is the
 * "registry unreachable" case the caller must treat as exit code 3, never a finding.
 */
async function fetchFreshFacts(
  identifier: string,
  ecosystem: Ecosystem,
  fetchImpl: typeof fetch | undefined,
): Promise<PackageFacts> {
  if (ecosystem === 'maven') {
    return getMavenCentralFacts(identifier, fetchImpl);
  }

  try {
    const depsDev = await getDepsDevFacts(ecosystem, identifier, fetchImpl);
    if (!depsDev.exists) return { exists: false };
    const weeklyDownloads = await fetchWeeklyDownloadsOnly(identifier, ecosystem, fetchImpl);
    return {
      exists: true,
      firstPublishedAt: depsDev.firstPublishedAt,
      repoUrl: depsDev.repoUrl,
      weeklyDownloads,
    };
  } catch {
    return ecosystem === 'npm'
      ? getNpmRegistryFacts(identifier, fetchImpl)
      : getPyPiRegistryFacts(identifier, fetchImpl);
  }
}

async function fetchFacts(
  identifier: string,
  ecosystem: Ecosystem,
  options: ResolveVerdictOptions,
): Promise<PackageFacts> {
  const { cache, fetchImpl } = options;
  const needsPopularity = ecosystem !== 'maven';

  const existence = cache?.get<CachedExistence>(ecosystem, identifier, 'existence');
  if (existence) {
    // A cached "does not exist" is a complete answer. Such a package never has a downloads figure,
    // so requiring one made every ghost name a permanent cache miss — a network call on the hook's
    // hot path, and, with the registry down, a hallucination downgraded to "unreachable".
    if (!existence.exists || !needsPopularity) return { ...existence };

    const popularity = cache?.get<CachedPopularity>(ecosystem, identifier, 'popularity');
    if (popularity) return { ...existence, weeklyDownloads: popularity.weeklyDownloads };

    // Existence is known; only the downloads figure is missing or expired. Fetch just that: one
    // request that never throws, so a package we already know about stays checkable offline.
    // A failed lookup is not cached — that would hide the low-downloads signal for the whole
    // popularity TTL after one flaky pypistats call.
    const weeklyDownloads = await fetchWeeklyDownloadsOnly(
      identifier,
      ecosystem as 'npm' | 'pypi',
      fetchImpl,
    );
    if (weeklyDownloads !== undefined) {
      cache?.set(ecosystem, identifier, 'popularity', { weeklyDownloads });
    }
    return { ...existence, weeklyDownloads };
  }

  const facts = await fetchFreshFacts(identifier, ecosystem, fetchImpl);
  cache?.set(ecosystem, identifier, 'existence', {
    exists: facts.exists,
    firstPublishedAt: facts.firstPublishedAt,
    repoUrl: facts.repoUrl,
  });
  if (facts.weeklyDownloads !== undefined) {
    cache?.set(ecosystem, identifier, 'popularity', { weeklyDownloads: facts.weeklyDownloads });
  }
  return facts;
}

/**
 * The orchestrator: composes the allowlist, the lockfile, the cache, the registry clients, and
 * the rule engine into one call per identifier.
 *
 * An allowlisted identifier (FR-5.1) never touches the network and always comes back CLEAN
 * (flagged `suppressedBy: 'allowlist'`). Anything else is resolved via {@link fetchFacts} and
 * handed to `evaluatePackage`. A lockfile pin (FR-3.4) does **not** skip that: a lockfile can be
 * edited by hand or by an agent, so a pinned package is evaluated like any other and the pin only
 * softens "not on the public registry" (see `applyLockfilePin`). If every available registry
 * source failed, the result is `{ kind: 'unreachable' }` (NFR-3.1) rather than a fabricated
 * verdict — pinned or not.
 */
export async function resolveVerdict(
  identifier: string,
  ecosystem: Ecosystem,
  options: ResolveVerdictOptions = {},
): Promise<ResolveVerdictResult> {
  if (options.allowlist && isAllowlisted(identifier, options.allowlist)) {
    return {
      kind: 'verdict',
      verdict: {
        identifier,
        ecosystem,
        tier: 'CLEAN',
        signals: [],
        reason: 'Allowlisted in .slopsquatshield, so not checked.',
        suppressedBy: 'allowlist',
      },
    };
  }

  // A lockfile pin is evidence of where the package came from, not proof it is safe (it can be
  // edited by hand or by an agent). It no longer skips the checks — see `applyLockfilePin`.
  const pinned =
    options.lockfileIndex !== undefined &&
    resolveViaLockfile(identifier, options.lockfileIndex) !== undefined;

  try {
    const facts = await fetchFacts(identifier, ecosystem, options);
    const verdict = evaluatePackage(identifier, ecosystem, facts, options);
    return { kind: 'verdict', verdict: applyLockfilePin(verdict, pinned, options.privateScope) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: 'unreachable',
      identifier,
      ecosystem,
      // A pinned package is never reported clean just because it could not be checked.
      error: pinned
        ? `pinned in the lockfile, but its risk signals could not be fetched — ${message}`
        : message,
    };
  }
}
