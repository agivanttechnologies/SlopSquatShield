// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePoetryLock } from '../../../src/resolvers/lockfile/poetry.js';

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/pypi/lockfile/${name}`, import.meta.url)),
    'utf-8',
  );
}

describe('parsePoetryLock', () => {
  it('parses every [[package]] table into a name/version pin', () => {
    const pins = parsePoetryLock(readFixture('poetry.lock'));

    expect(pins).toEqual([
      { name: 'requests', version: '2.31.0' },
      { name: 'certifi', version: '2024.2.2' },
    ]);
  });
});
