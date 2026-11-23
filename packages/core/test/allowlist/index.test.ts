// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { appendToAllowlist, isAllowlisted, parseAllowlist } from '../../src/allowlist/index.js';

describe('parseAllowlist', () => {
  it('parses one identifier per line, ignoring comments and blank lines', () => {
    const content = [
      '# allowlisted packages',
      'lodash',
      '',
      'left-pad # known-safe, audited manually',
      '  # a full-line comment',
      'org.apache.commons:commons-lang3',
    ].join('\n');

    expect(parseAllowlist(content)).toEqual(
      new Set(['lodash', 'left-pad', 'org.apache.commons:commons-lang3']),
    );
  });

  it('returns an empty set for empty content', () => {
    expect(parseAllowlist('')).toEqual(new Set());
  });
});

describe('isAllowlisted', () => {
  it('matches an identifier present in the allowlist', () => {
    const allowlist = parseAllowlist('lodash\n');
    expect(isAllowlisted('lodash', allowlist)).toBe(true);
    expect(isAllowlisted('not-listed', allowlist)).toBe(false);
  });
});

describe('appendToAllowlist', () => {
  it('creates fresh content when none exists yet (FR-5.3: creates file if absent)', () => {
    expect(appendToAllowlist(undefined, 'lodash')).toBe('lodash\n');
  });

  it('appends a trailing newline before adding the new identifier', () => {
    expect(appendToAllowlist('lodash', 'express')).toBe('lodash\nexpress\n');
  });

  it('does not add a duplicate blank line when content already ends with a newline', () => {
    expect(appendToAllowlist('lodash\n', 'express')).toBe('lodash\nexpress\n');
  });
});
