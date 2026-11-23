// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getPyPiRegistryFacts } from '../../src/registry/pypi.js';
import { server } from '../msw/server.js';

const PYPI = 'https://pypi.org/pypi';
const STATS = 'https://pypistats.org/api/packages';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('getPyPiRegistryFacts', () => {
  it('resolves existence, first-publish date, repo link, and weekly downloads', async () => {
    server.use(
      http.get(`${PYPI}/requests/json`, () =>
        HttpResponse.json({
          info: {
            project_urls: {
              Homepage: 'https://requests.readthedocs.io',
              Source: 'https://github.com/psf/requests',
            },
          },
          releases: {
            '1.0.0': [{ upload_time_iso_8601: '2011-02-14T00:13:56.000000Z' }],
            '2.31.0': [{ upload_time_iso_8601: '2023-05-22T15:12:44.000000Z' }],
          },
        }),
      ),
      http.get(`${STATS}/requests/recent`, () =>
        HttpResponse.json({ data: { last_day: 1, last_week: 60_000_000, last_month: 1 } }),
      ),
    );

    const facts = await getPyPiRegistryFacts('requests');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: '2011-02-14T00:13:56.000000Z',
      repoUrl: 'https://github.com/psf/requests',
      weeklyDownloads: 60_000_000,
    });
  });

  it('reports exists: false on a 404 (name does not exist)', async () => {
    server.use(
      http.get(`${PYPI}/definitely-a-hallucinated-name-xyz/json`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );

    const facts = await getPyPiRegistryFacts('definitely-a-hallucinated-name-xyz');
    expect(facts).toEqual({ exists: false });
  });

  it('throws on a 5xx — registry-unreachable stays distinct from non-existence', async () => {
    server.use(
      http.get(`${PYPI}/flaky-registry-case/json`, () =>
        HttpResponse.json({ error: 'internal' }, { status: 503 }),
      ),
    );

    await expect(getPyPiRegistryFacts('flaky-registry-case')).rejects.toThrow(/503/);
  });

  it('leaves repoUrl undefined when project_urls has no source/repo-like key', async () => {
    server.use(
      http.get(`${PYPI}/some-lib/json`, () =>
        HttpResponse.json({
          info: { project_urls: { 'Bug Tracker': 'https://example.com/issues' } },
          releases: { '1.0.0': [{ upload_time_iso_8601: '2023-01-01T00:00:00.000000Z' }] },
        }),
      ),
      http.get(`${STATS}/some-lib/recent`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const facts = await getPyPiRegistryFacts('some-lib');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: '2023-01-01T00:00:00.000000Z',
      repoUrl: undefined,
      weeklyDownloads: undefined,
    });
  });
});
