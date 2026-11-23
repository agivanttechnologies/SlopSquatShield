// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isLocalNpmSpecifier } from '../../src/extractors/npm.js';
import type { ExtractedDependency } from '../../src/extractors/types.js';
import { excludeLocalPackages, packageJsonName } from '../../src/scan/local-packages.js';

describe('isLocalNpmSpecifier', () => {
  it.each([
    'file:../x',
    'link:../x',
    'workspace:*',
    'portal:../x',
    'git+https://github.com/a/b.git',
    'github:a/b',
    'https://example.com/x.tgz',
    './local',
    '../up',
    '/abs/path',
    '~/home/pkg',
  ])('%s is local', (spec) => expect(isLocalNpmSpecifier(spec)).toBe(true));

  it.each(['^1.2.3', '*', 'latest', '1.0.0', '>=2 <3', 'npm:other@^1', undefined, ''])(
    '%j is a registry specifier',
    (spec) => expect(isLocalNpmSpecifier(spec)).toBe(false),
  );
});

describe('packageJsonName', () => {
  it('reads the name', () => expect(packageJsonName('{"name":"@a/b"}')).toBe('@a/b'));
  it.each(['{}', '{"name":""}', '{"name":3}', 'not json', ''])('is undefined for %j', (c) =>
    expect(packageJsonName(c)).toBeUndefined(),
  );
});

describe('excludeLocalPackages', () => {
  const dep = (name: string, specifier?: string, ecosystem: 'npm' | 'pypi' = 'npm') =>
    ({ name, ecosystem, specifier, source: 'x' }) as ExtractedDependency;

  it('drops workspace members by name and local specifiers, keeps registry packages', () => {
    const out = excludeLocalPackages(
      [
        dep('@acme/core', '*'),
        dep('left-pad', '^1'),
        dep('x', 'file:../x'),
        dep('y', 'workspace:^'),
      ],
      new Set(['@acme/core']),
    );
    expect(out.map((d) => d.name)).toEqual(['left-pad']);
  });

  it('never touches non-npm dependencies, even if the name collides', () => {
    const out = excludeLocalPackages(
      [dep('@acme/core', undefined, 'pypi')],
      new Set(['@acme/core']),
    );
    expect(out).toHaveLength(1);
  });
});
