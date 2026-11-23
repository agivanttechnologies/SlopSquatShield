// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `src/index.ts` runs the CLI on import, so it can't be loaded here. This guards the one thing
// that kept going wrong in it: internal requirement ids ("(FR-10.1)") leaking into the text a
// person sees in `--help`.
describe('--help text', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
    'utf-8',
  );

  it('contains no internal requirement ids in any string a person can read', () => {
    const leaks = source.split('\n').filter((line) => /['"`][^'"`\n]*\(FR-\d/.test(line));
    expect(leaks).toEqual([]);
  });
});
