// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractPipfileDeps } from '../../../src/extractors/python/pipfile.js';

const fixturePath = fileURLToPath(new URL('../../fixtures/pypi/pipfile/Pipfile', import.meta.url));
const fixture = readFileSync(fixturePath, 'utf-8');

describe('extractPipfileDeps', () => {
  it('extracts all 10 deps (7 packages + 3 dev-packages) with zero missed entries', () => {
    const deps = extractPipfileDeps(fixture);
    expect(deps).toHaveLength(10);
  });

  it('treats a bare "*" version as no specifier', () => {
    const deps = extractPipfileDeps(fixture);
    const requests = deps.find((d) => d.name === 'requests');
    expect(requests?.specifier).toBeUndefined();
  });

  it('handles table-form entries with extras', () => {
    const deps = extractPipfileDeps(fixture);
    const uvicorn = deps.find((d) => d.name === 'uvicorn');
    expect(uvicorn?.specifier).toBe('==0.30.6');
    expect(uvicorn?.extras).toEqual(['standard']);
  });

  it('includes dev-packages entries', () => {
    const deps = extractPipfileDeps(fixture);
    expect(deps.map((d) => d.name)).toEqual(expect.arrayContaining(['pytest', 'black', 'mypy']));
  });
});
