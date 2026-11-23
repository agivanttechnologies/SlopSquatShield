// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractRequirementsTxtDeps } from '../../../src/extractors/python/requirements.js';

const fixturePath = fileURLToPath(
  new URL('../../fixtures/pypi/requirements/basic.txt', import.meta.url),
);
const fixture = readFileSync(fixturePath, 'utf-8');

describe('extractRequirementsTxtDeps', () => {
  it('extracts exactly the 10 real requirements, skipping comments/blanks/directives', () => {
    const deps = extractRequirementsTxtDeps(fixture);
    expect(deps).toHaveLength(10);
    expect(deps.map((d) => d.name)).not.toContain('other-requirements.txt');
  });

  it('captures extras and specifiers correctly', () => {
    const deps = extractRequirementsTxtDeps(fixture);
    const requests = deps.find((d) => d.name === 'requests');
    expect(requests?.extras).toEqual(['socks']);
    expect(requests?.specifier).toBe('>=2.31,<3');

    const flask = deps.find((d) => d.name === 'flask');
    expect(flask?.extras).toBeUndefined();
    expect(flask?.specifier).toBeUndefined();
  });

  it('tags every dependency with the pypi ecosystem', () => {
    const deps = extractRequirementsTxtDeps(fixture);
    expect(deps.every((d) => d.ecosystem === 'pypi')).toBe(true);
  });
});
