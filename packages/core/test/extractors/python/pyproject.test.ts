// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractPyprojectDeps } from '../../../src/extractors/python/pyproject.js';

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/pypi/pyproject/${name}`, import.meta.url)),
    'utf-8',
  );
}

describe('extractPyprojectDeps — PEP 621 shape', () => {
  const fixture = readFixture('pep621.toml');

  it('extracts all 10 deps (7 core + 3 optional) with zero missed entries', () => {
    const deps = extractPyprojectDeps(fixture);
    expect(deps).toHaveLength(10);
  });

  it('captures extras and specifiers, including bare names with no specifier', () => {
    const deps = extractPyprojectDeps(fixture);
    const uvicorn = deps.find((d) => d.name === 'uvicorn');
    expect(uvicorn?.extras).toEqual(['standard']);
    expect(uvicorn?.specifier).toBe('==0.30.6');

    const flask = deps.find((d) => d.name === 'flask');
    expect(flask?.specifier).toBeUndefined();
  });

  it('includes optional-dependencies group members', () => {
    const deps = extractPyprojectDeps(fixture);
    expect(deps.map((d) => d.name)).toEqual(expect.arrayContaining(['pytest', 'black', 'mkdocs']));
  });
});

describe('extractPyprojectDeps — Poetry shape', () => {
  const fixture = readFixture('poetry.toml');

  it('extracts all 10 deps, excluding the python interpreter constraint', () => {
    const deps = extractPyprojectDeps(fixture);
    expect(deps).toHaveLength(10);
    expect(deps.map((d) => d.name)).not.toContain('python');
  });

  it('handles both string and table dependency value shapes', () => {
    const deps = extractPyprojectDeps(fixture);
    const requests = deps.find((d) => d.name === 'requests');
    expect(requests?.specifier).toBe('^2.31');

    const httpx = deps.find((d) => d.name === 'httpx');
    expect(httpx?.specifier).toBe('^0.27.0');
    expect(httpx?.extras).toEqual(['http2']);
  });
});
