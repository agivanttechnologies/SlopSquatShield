// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { findSimilarPopularPackage } from '../../src/rules/similarity.js';

describe('findSimilarPopularPackage', () => {
  const popular = ['lodash', 'react', 'express', 'requests'];

  it('finds a match within the max distance', () => {
    expect(findSimilarPopularPackage('lodahs', popular, 2)).toEqual({
      matchedName: 'lodash',
      distance: 2,
    });
  });

  it('returns undefined when nothing is within the max distance', () => {
    expect(findSimilarPopularPackage('completely-unrelated-name', popular, 2)).toBeUndefined();
  });

  it('excludes an exact match — the same package is not a typosquat of itself', () => {
    expect(findSimilarPopularPackage('lodash', popular, 2)).toBeUndefined();
  });

  it('picks the closest match when multiple are within range', () => {
    expect(findSimilarPopularPackage('reqests', popular, 3)).toEqual({
      matchedName: 'requests',
      distance: 1,
    });
  });
});
