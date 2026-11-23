// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isExpectedPrivate } from '../../src/rules/dependency-confusion.js';

describe('isExpectedPrivate', () => {
  it('matches an npm scope', () => {
    expect(isExpectedPrivate('@myorg/tool', 'npm', { npmScopes: ['@myorg'] })).toBe(true);
    expect(isExpectedPrivate('@otherorg/tool', 'npm', { npmScopes: ['@myorg'] })).toBe(false);
  });

  it('matches a PyPI private-index naming pattern', () => {
    const config = { pypiIndexPattern: /^myorg-/ };
    expect(isExpectedPrivate('myorg-internal-lib', 'pypi', config)).toBe(true);
    expect(isExpectedPrivate('requests', 'pypi', config)).toBe(false);
  });

  it('matches a Maven groupId prefix, including nested sub-groups', () => {
    const config = { mavenGroupPrefixes: ['com.myorg'] };
    expect(isExpectedPrivate('com.myorg:internal-lib', 'maven', config)).toBe(true);
    expect(isExpectedPrivate('com.myorg.team:internal-lib', 'maven', config)).toBe(true);
    expect(isExpectedPrivate('com.otherorg:lib', 'maven', config)).toBe(false);
  });

  it('does not false-positive on a groupId that merely starts with the same characters', () => {
    // "com.myorgextra" should not match a "com.myorg" prefix — it's a different group.
    expect(
      isExpectedPrivate('com.myorgextra:lib', 'maven', { mavenGroupPrefixes: ['com.myorg'] }),
    ).toBe(false);
  });

  it('returns false when nothing is configured for that ecosystem', () => {
    expect(isExpectedPrivate('@myorg/tool', 'npm', {})).toBe(false);
  });
});
