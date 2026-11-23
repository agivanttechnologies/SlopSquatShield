// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePipfileLock } from '../../../src/resolvers/lockfile/pipfile.js';

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/pypi/lockfile/${name}`, import.meta.url)),
    'utf-8',
  );
}

describe('parsePipfileLock', () => {
  it('parses both default and develop sections, stripping the leading `==`', () => {
    const pins = parsePipfileLock(readFixture('Pipfile.lock'));

    expect(pins).toEqual([
      { name: 'requests', version: '2.31.0' },
      { name: 'certifi', version: '2024.2.2' },
      { name: 'pytest', version: '8.1.1' },
    ]);
  });
});
