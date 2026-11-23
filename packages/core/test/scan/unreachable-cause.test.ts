// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { describeUnreachable } from '../../src/scan/unreachable-cause.js';

describe('describeUnreachable', () => {
  it.each([
    [
      'request to https://registry.npmjs.org/x failed, reason: connect ECONNREFUSED 127.0.0.1:9',
      'connection refused',
    ],
    ['getaddrinfo ENOTFOUND registry.npmjs.org', 'could not look up the registry (offline?)'],
    ['network timeout at: https://pypi.org/pypi/x/json', 'timed out'],
    ['not checked: time budget exceeded', 'ran out of time'],
    ['407 Proxy Authentication Required', 'proxy error'],
    ['unable to verify the first certificate', 'TLS certificate problem'],
    ['503 Service Unavailable - GET https://registry.npmjs.org/x', 'HTTP 503'],
    ['read ECONNRESET', 'connection reset'],
  ])('%s → %s', (error, cause) => {
    expect(describeUnreachable(error)).toBe(cause);
  });

  it('keeps that a lockfile-pinned package was the one not checked', () => {
    expect(
      describeUnreachable(
        'pinned in the lockfile, but its risk signals could not be fetched — connect ECONNREFUSED 1.2.3.4:443',
      ),
    ).toBe('pinned in the lockfile; connection refused');
  });

  it('shortens anything it does not recognise instead of printing a wall of text', () => {
    const out = describeUnreachable(`something odd happened ${'x'.repeat(200)}`);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.startsWith('something odd happened')).toBe(true);
  });
});
