// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { buildLockfileIndex, resolveViaLockfile } from '../../src/resolvers/types.js';

describe('buildLockfileIndex / resolveViaLockfile', () => {
  it('indexes pins by name, collecting every distinct version seen for a name', () => {
    const index = buildLockfileIndex([
      { name: 'express', version: '4.19.2' },
      { name: 'debug', version: '2.6.9' },
      { name: 'debug', version: '4.3.4' },
    ]);

    expect(resolveViaLockfile('express', index)).toEqual(new Set(['4.19.2']));
    expect(resolveViaLockfile('debug', index)).toEqual(new Set(['2.6.9', '4.3.4']));
  });

  it('returns undefined for a name absent from the lockfile — not a finding, just no fast path', () => {
    const index = buildLockfileIndex([{ name: 'express', version: '4.19.2' }]);
    expect(resolveViaLockfile('definitely-not-locked', index)).toBeUndefined();
  });
});
