// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNpmLockfile } from '../../../src/resolvers/lockfile/npm.js';

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/npm/lockfile/${name}`, import.meta.url)),
    'utf-8',
  );
}

describe('parseNpmLockfile', () => {
  it('parses a v3 lockfile (flat `packages` map), excluding the root project entry', () => {
    const pins = parseNpmLockfile(readFixture('package-lock.v3.json'));

    expect(pins).toContainEqual({ name: 'express', version: '4.19.2' });
    expect(pins).toContainEqual({ name: 'lodash', version: '4.17.21' });
    expect(pins).toContainEqual({ name: 'debug', version: '2.6.9' });
    expect(pins.find((p) => p.name === 'fixture-app')).toBeUndefined();
  });

  it('parses a v1 lockfile (nested `dependencies` tree), recursing into nested deps', () => {
    const pins = parseNpmLockfile(readFixture('package-lock.v1.json'));

    expect(pins).toContainEqual({ name: 'express', version: '4.19.2' });
    expect(pins).toContainEqual({ name: 'lodash', version: '4.17.21' });
    expect(pins).toContainEqual({ name: 'debug', version: '2.6.9' });
  });
});
