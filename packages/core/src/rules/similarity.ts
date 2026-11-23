// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { distance } from 'fastest-levenshtein';

export interface SimilarityMatch {
  matchedName: string;
  distance: number;
}

/**
 * Finds the closest match for `identifier` in a maintained top-N "popular package"
 * reference list (FR-4.3) — never the full registry, which would make almost every real
 * package "similar" to something. An exact match (distance 0) is the same package, not a
 * typosquat of it, so it's excluded; the closest match at or under `maxDistance` wins.
 */
export function findSimilarPopularPackage(
  identifier: string,
  popularPackages: readonly string[],
  maxDistance: number,
): SimilarityMatch | undefined {
  let best: SimilarityMatch | undefined;
  for (const popular of popularPackages) {
    if (popular === identifier) continue;
    const d = distance(identifier, popular);
    if (d <= maxDistance && (!best || d < best.distance)) {
      best = { matchedName: popular, distance: d };
    }
  }
  return best;
}
