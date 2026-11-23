// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getNpmRegistryFacts } from '../../src/registry/npm.js';
import { proxyFetch } from '../../src/registry/proxy-fetch.js';
import { PROJECT_URL, getUserAgent, setUserAgent } from '../../src/registry/user-agent.js';
import { server } from '../msw/server.js';

const DEFAULT = getUserAgent();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setUserAgent('slopsquatshield', '0.0.0-test');
});
afterAll(() => server.close());

describe('User-Agent (registry terms: identify automated clients)', () => {
  it('defaults to the product name and project URL, with nothing about the user', () => {
    expect(DEFAULT).toBe(`slopsquatshield (+${PROJECT_URL})`);
  });

  it('setUserAgent sets product/version (+URL)', () => {
    setUserAgent('slopsquatshield-vscode', '1.2.3');
    expect(getUserAgent()).toBe(`slopsquatshield-vscode/1.2.3 (+${PROJECT_URL})`);
  });

  it('proxyFetch sends it on every request', async () => {
    setUserAgent('slopsquatshield', '9.9.9');
    let seen: string | null = null;
    server.use(
      http.get('https://api.deps.dev/ua-probe', ({ request }) => {
        seen = request.headers.get('user-agent');
        return HttpResponse.json({});
      }),
    );
    await proxyFetch('https://api.deps.dev/ua-probe');
    expect(seen).toBe(`slopsquatshield/9.9.9 (+${PROJECT_URL})`);
  });

  it("proxyFetch keeps a caller's own User-Agent and other headers", async () => {
    let seen: { ua: string | null; accept: string | null } | undefined;
    server.use(
      http.get('https://api.deps.dev/ua-probe', ({ request }) => {
        seen = { ua: request.headers.get('user-agent'), accept: request.headers.get('accept') };
        return HttpResponse.json({});
      }),
    );
    await proxyFetch('https://api.deps.dev/ua-probe', {
      headers: { 'user-agent': 'custom/1', accept: 'application/json' },
    });
    expect(seen).toEqual({ ua: 'custom/1', accept: 'application/json' });
  });

  it('the npm registry client (npm-registry-fetch) sends it too', async () => {
    setUserAgent('slopsquatshield', '9.9.9');
    let seen: string | null = null;
    server.use(
      http.get(/^https:\/\/registry\.npmjs\.org(:\d+)?\/ua-probe-pkg$/, ({ request }) => {
        seen = request.headers.get('user-agent');
        return HttpResponse.json({ time: { created: '2020-01-01T00:00:00.000Z' } });
      }),
      http.get('https://api.npmjs.org/downloads/point/last-week/ua-probe-pkg', () =>
        HttpResponse.json({ downloads: 1 }),
      ),
    );
    await getNpmRegistryFacts('ua-probe-pkg');
    expect(seen).toBe(`slopsquatshield/9.9.9 (+${PROJECT_URL})`);
  });
});
