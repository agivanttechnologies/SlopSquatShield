// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDepsDevFacts } from '../../src/registry/deps-dev.js';
import { getNpmRegistryFacts } from '../../src/registry/npm.js';
import { MAX_RETRY_AFTER_MS, proxyFetch, retryAfterMs } from '../../src/registry/proxy-fetch.js';
import { server } from '../msw/server.js';

// None of the services we call publishes a rate limit; all answer 429 to bursts. These pin what
// we do then: one short retry at most, and otherwise "couldn't check" — never a long stall.
const PROBE = 'https://api.deps.dev/v3/probe';
const DEPS_DEV = 'https://api.deps.dev/v3/systems/NPM/packages';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Answers 429 (with the given Retry-After) `times` times, then 200. Counts the calls. */
function rateLimited(url: string, retryAfter: string | undefined, times = 1) {
  const state = { calls: 0 };
  server.use(
    http.get(url, () => {
      state.calls++;
      if (state.calls <= times) {
        const headers = retryAfter === undefined ? undefined : { 'retry-after': retryAfter };
        return new HttpResponse(null, { status: 429, headers });
      }
      return HttpResponse.json({ ok: true });
    }),
  );
  return state;
}

describe('retryAfterMs', () => {
  it('reads delta-seconds and HTTP dates; anything else is undefined', () => {
    const now = Date.parse('2026-11-23T10:00:00Z');
    expect(retryAfterMs('0', now)).toBe(0);
    expect(retryAfterMs(' 2 ', now)).toBe(2000);
    expect(retryAfterMs('Mon, 23 Nov 2026 10:00:01 GMT', now)).toBe(1000);
    expect(retryAfterMs('Mon, 23 Nov 2026 09:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs(null, now)).toBeUndefined();
    expect(retryAfterMs('soon', now)).toBeUndefined();
    expect(retryAfterMs('-1', now)).toBeUndefined();
  });
});

describe('proxyFetch on HTTP 429', () => {
  it('waits out a short Retry-After and retries once', async () => {
    const state = rateLimited(PROBE, '0');
    const res = await proxyFetch(PROBE);
    expect(res.status).toBe(200);
    expect(state.calls).toBe(2);
  });

  it('retries only once, even if the second answer is 429 too', async () => {
    const state = rateLimited(PROBE, '0', 5);
    const res = await proxyFetch(PROBE);
    expect(res.status).toBe(429);
    expect(state.calls).toBe(2);
  });

  it(`does not wait longer than ${MAX_RETRY_AFTER_MS} ms: a long Retry-After comes straight back`, async () => {
    const state = rateLimited(PROBE, '60');
    const started = Date.now();
    const res = await proxyFetch(PROBE);
    expect(res.status).toBe(429);
    expect(state.calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not retry a 429 without Retry-After', async () => {
    const state = rateLimited(PROBE, undefined);
    expect((await proxyFetch(PROBE)).status).toBe(429);
    expect(state.calls).toBe(1);
  });

  it('a rate-limited deps.dev is "couldn\'t check" (throws), never "does not exist"', async () => {
    rateLimited(`${DEPS_DEV}/limited-pkg`, '60', 99);
    await expect(getDepsDevFacts('npm', 'limited-pkg')).rejects.toThrow(/HTTP 429/);
  });
});

describe('npm registry fallback on HTTP 429', () => {
  it("gives up after one short retry instead of npm-registry-fetch's long default backoff", async () => {
    const state = { calls: 0 };
    server.use(
      http.get(/^https:\/\/registry\.npmjs\.org(:\d+)?\/limited-pkg$/, () => {
        state.calls++;
        return new HttpResponse(null, { status: 429 });
      }),
    );
    const started = Date.now();
    await expect(getNpmRegistryFacts('limited-pkg')).rejects.toThrow();
    expect(state.calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
