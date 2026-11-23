// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getDepsDevFacts } from '../../src/registry/deps-dev.js';
import { server } from '../msw/server.js';

const BASE = 'https://api.deps.dev/v3';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('getDepsDevFacts', () => {
  it('resolves existence, first-publish date, and repo link for a real npm package', async () => {
    server.use(
      http.get(`${BASE}/systems/NPM/packages/express`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '3.0.0' },
              publishedAt: '2010-01-01T00:00:00Z',
              isDefault: false,
            },
            {
              versionKey: { version: '4.19.2' },
              publishedAt: '2024-03-20T00:00:00Z',
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${BASE}/systems/NPM/packages/express/versions/4.19.2`, () =>
        HttpResponse.json({
          relatedProjects: [
            { projectKey: { id: 'github.com/expressjs/express' }, relationType: 'SOURCE_REPO' },
          ],
        }),
      ),
    );

    const facts = await getDepsDevFacts('npm', 'express');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: '2010-01-01T00:00:00Z',
      repoUrl: 'https://github.com/expressjs/express',
    });
  });

  it('reports exists: false with no other facts on a 404 (name does not exist)', async () => {
    server.use(
      http.get(`${BASE}/systems/NPM/packages/definitely-a-hallucinated-name-xyz`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const facts = await getDepsDevFacts('npm', 'definitely-a-hallucinated-name-xyz');
    expect(facts).toEqual({ exists: false });
  });

  it('resolves a PyPI package with no declared source repo (repoUrl left undefined)', async () => {
    server.use(
      http.get(`${BASE}/systems/PYPI/packages/some-lib`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '1.0.0' },
              publishedAt: '2023-05-01T00:00:00Z',
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${BASE}/systems/PYPI/packages/some-lib/versions/1.0.0`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
    );

    const facts = await getDepsDevFacts('pypi', 'some-lib');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: '2023-05-01T00:00:00Z',
      repoUrl: undefined,
    });
  });

  it('resolves Maven coordinates using the same client', async () => {
    server.use(
      http.get(`${BASE}/systems/MAVEN/packages/org.apache.commons:commons-lang3`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '3.14.0' },
              publishedAt: '2023-10-19T00:00:00Z',
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(
        `${BASE}/systems/MAVEN/packages/org.apache.commons:commons-lang3/versions/3.14.0`,
        () =>
          HttpResponse.json({
            relatedProjects: [
              { projectKey: { id: 'github.com/apache/commons-lang' }, relationType: 'SOURCE_REPO' },
            ],
          }),
      ),
    );

    const facts = await getDepsDevFacts('maven', 'org.apache.commons:commons-lang3');
    expect(facts).toEqual({
      exists: true,
      firstPublishedAt: '2023-10-19T00:00:00Z',
      repoUrl: 'https://github.com/apache/commons-lang',
    });
  });

  it('throws (does not report exists: false) on a 5xx — registry-unreachable stays distinct from non-existence', async () => {
    server.use(
      http.get(`${BASE}/systems/NPM/packages/flaky-registry-case`, () =>
        HttpResponse.json({ error: 'internal' }, { status: 503 }),
      ),
    );

    await expect(getDepsDevFacts('npm', 'flaky-registry-case')).rejects.toThrow(/503/);
  });

  it('never includes a downloads/popularity field — deps.dev has no such metric', async () => {
    server.use(
      http.get(`${BASE}/systems/NPM/packages/express`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '4.19.2' },
              publishedAt: '2024-03-20T00:00:00Z',
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${BASE}/systems/NPM/packages/express/versions/4.19.2`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
    );

    const facts = await getDepsDevFacts('npm', 'express');
    expect(facts).not.toHaveProperty('downloads');
  });
});
