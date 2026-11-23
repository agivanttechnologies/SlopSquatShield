// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractNpmDeps, resolveNpmAlias } from '../../src/extractors/npm.js';

const fixturePath = fileURLToPath(
  new URL('../fixtures/npm/package-json/basic.json', import.meta.url),
);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

describe('extractNpmDeps', () => {
  it('extracts every dependency across all four fields with zero missed entries', () => {
    const deps = extractNpmDeps(fixture);
    // 20 declarations total across 4 fields; left-pad appears twice (conflict) -> 19 unique names.
    expect(deps).toHaveLength(19);
  });

  it('flags a cross-field version conflict without dropping either specifier', () => {
    const deps = extractNpmDeps(fixture);
    const leftPad = deps.find((d) => d.name === 'left-pad');
    expect(leftPad?.conflict).toBeDefined();
    expect(leftPad?.conflict?.specifiers).toEqual(['^1.3.0', '^1.2.0']);
    expect(leftPad?.conflict?.fields).toEqual(['dependencies', 'devDependencies']);
  });

  it('does not flag a conflict for deps that appear in only one field', () => {
    const deps = extractNpmDeps(fixture);
    const express = deps.find((d) => d.name === 'express');
    expect(express?.conflict).toBeUndefined();
    expect(express?.specifier).toBe('^4.19.2');
  });

  it('tags every dependency with the npm ecosystem', () => {
    const deps = extractNpmDeps(fixture);
    expect(deps.every((d) => d.ecosystem === 'npm')).toBe(true);
  });
});

describe('npm aliases ("name": "npm:real-package@range")', () => {
  it('checks the package actually installed, keeping the declared name as the alias', () => {
    expect(
      extractNpmDeps({
        dependencies: { lodash: 'npm:react-codeshift@^1.0.0', '@types/x': 'npm:@evil/pkg' },
      }),
    ).toEqual([
      {
        name: 'react-codeshift',
        ecosystem: 'npm',
        specifier: '^1.0.0',
        source: 'dependencies',
        alias: 'lodash',
      },
      {
        name: '@evil/pkg',
        ecosystem: 'npm',
        specifier: undefined,
        source: 'dependencies',
        alias: '@types/x',
      },
    ]);
  });

  it('checks every package when two fields alias the same key to different ones', () => {
    const deps = extractNpmDeps({
      dependencies: { util: 'npm:pkg-one@1' },
      devDependencies: { util: 'npm:pkg-two@2' },
    });
    expect(deps.map((d) => d.name)).toEqual(['pkg-one', 'pkg-two']);
  });

  it('leaves ordinary specifiers alone', () => {
    expect(resolveNpmAlias('a', '^1')).toEqual({ name: 'a', specifier: '^1' });
    expect(resolveNpmAlias('a', undefined)).toEqual({ name: 'a', specifier: undefined });
    expect(resolveNpmAlias('a', 'npm:')).toEqual({ name: 'a', specifier: 'npm:' });
  });
});
