// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { type PrivateScopeConfig, isExpectedPrivate } from '../rules/dependency-confusion.js';
import { buildReason } from '../rules/engine.js';
import { publicRegistry } from '../rules/registry-label.js';
import type { Signal, Verdict } from '../rules/types.js';

/**
 * What a lockfile pin changes about a verdict (FR-3.4, revised after release testing).
 *
 * A pin used to short-circuit everything: "npm already resolved it, so it is verified". But a
 * lockfile can be edited by hand — or by an AI agent — so a pin is evidence about *where the
 * package came from*, not proof that it is safe. A pinned package therefore goes through the
 * normal rules (age, downloads, name similarity, repository link), and the pin only softens one
 * outcome: **"not on the public registry"**.
 *
 * - Not on the public registry, and the name matches a declared private scope → CLEAN: an
 *   expected private package, exactly what the pin says it is.
 * - Not on the public registry otherwise → **WARN, not BLOCK**. A private or mirror-hosted package
 *   is a normal reason for a pinned name to be missing publicly (BLOCKing it would break every
 *   enterprise user), and a ghost name in a lockfile cannot be installed by `npm ci` anyway — but
 *   the person should still hear about it.
 * - Anything else (including a dependency-confusion BLOCK: the name resolves *publicly* although
 *   it should be private) is returned unchanged.
 */
export function applyLockfilePin(
  verdict: Verdict,
  pinned: boolean,
  privateScope?: PrivateScopeConfig,
): Verdict {
  if (!pinned || !isOnlyNonExistence(verdict)) return verdict;

  const { identifier, ecosystem } = verdict;
  if (privateScope && isExpectedPrivate(identifier, ecosystem, privateScope)) {
    return {
      identifier,
      ecosystem,
      tier: 'CLEAN',
      signals: [],
      reason: `Expected private package (matches your privateScopes): pinned in the lockfile, not on the public ${publicRegistry(ecosystem)}.`,
    };
  }

  const signals: Signal[] = [
    {
      type: 'non-existence',
      reason: `Pinned in the lockfile but not on the public ${publicRegistry(ecosystem)}: a private package (allowlist it, or declare its scope in privateScopes) or a hand-edited lockfile entry.`,
    },
  ];
  return {
    identifier,
    ecosystem,
    tier: 'WARN',
    signals,
    reason: buildReason(signals),
  };
}

function isOnlyNonExistence(verdict: Verdict): boolean {
  return (
    verdict.tier === 'BLOCK' &&
    verdict.signals.length > 0 &&
    verdict.signals.every((s) => s.type === 'non-existence')
  );
}
