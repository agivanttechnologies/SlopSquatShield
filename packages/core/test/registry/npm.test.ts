// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getNpmRegistryFacts } from '../../src/registry/npm.js';
import { server } from '../msw/server.js';

function registryUrl(name: string): RegExp {
  return new RegExp(`^https://registry\\.npmjs\\.org(:\\d+)?/${name}$`);
}
const DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('getNpmRegistryFacts', () => {
  it('resolves existence, first-publish date, repo link, and weekly downloads', async () => {
    server.use(
      http.get(registryUrl('express'), () =>
        HttpResponse.json({
          time: { created: '2010-01-01T00:00:00.000Z' },
          repository: { type: 'git', url: 'git+https://github.com/expressjs/express.git' },
        }),
      ),
      http.get(`${DOWNLOADS}/express`, () =>
        HttpResponse.json({ downloads: 25_000_000, package: 'express' }),
      ),
    );

    const facts = await getNpmRegistryFacts('express');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: '2010-01-01T00:00:00.000Z',
      repoUrl: 'https://github.com/expressjs/express',
      weeklyDownloads: 25_000_000,
    });
  });

  it('reports exists: false on a 404 (name does not exist)', async () => {
    server.use(
      http.get(registryUrl('definitely-a-hallucinated-name-xyz'), () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const facts = await getNpmRegistryFacts('definitely-a-hallucinated-name-xyz');
    expect(facts).toEqual({ exists: false });
  });

  it('throws on a 5xx — registry-unreachable stays distinct from non-existence', async () => {
    server.use(
      http.get(registryUrl('flaky-registry-case'), () =>
        HttpResponse.json({ error: 'internal' }, { status: 503 }),
      ),
    );

    await expect(getNpmRegistryFacts('flaky-registry-case')).rejects.toThrow();
  });

  it('soft-omits weeklyDownloads (does not throw) when the downloads endpoint fails', async () => {
    server.use(
      http.get(registryUrl('some-lib'), () =>
        HttpResponse.json({ time: { created: '2023-05-01T00:00:00.000Z' } }),
      ),
      http.get(`${DOWNLOADS}/some-lib`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const facts = await getNpmRegistryFacts('some-lib');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: '2023-05-01T00:00:00.000Z',
      repoUrl: undefined,
      weeklyDownloads: undefined,
    });
  });
});
