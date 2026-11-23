// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createScanLimit, scanDependencies } from '../../src/scan/scan-dependencies.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mockNonexistent(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );
}

function mockClean(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({
        versions: [
          {
            versionKey: { version: '1.0.0' },
            publishedAt: '2010-01-01T00:00:00Z',
            isDefault: true,
          },
        ],
      }),
    ),
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}/versions/1.0.0`, () =>
      HttpResponse.json({
        relatedProjects: [
          { projectKey: { id: `github.com/x/${name}` }, relationType: 'SOURCE_REPO' },
        ],
      }),
    ),
    http.get(NPM_REGISTRY, () =>
      HttpResponse.json({ time: { created: '2010-01-01T00:00:00.000Z' } }),
    ),
    http.get(`${NPM_DOWNLOADS}/${name}`, () => HttpResponse.json({ downloads: 999_999 })),
  );
}

function mockUnreachable(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'internal' }, { status: 503 }),
    ),
    http.get(NPM_REGISTRY, () => HttpResponse.json({ error: 'internal' }, { status: 503 })),
  );
}

describe('scanDependencies', () => {
  it('exits HALLUCINATION (2) when any target BLOCKs, even with WARNs also present', async () => {
    mockNonexistent('ssg-test-not-a-real-package');
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/fresh-and-unpopular`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '1.0.0' },
              publishedAt: new Date().toISOString(),
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${DEPS_DEV}/systems/NPM/packages/fresh-and-unpopular/versions/1.0.0`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
      http.get(NPM_REGISTRY, () =>
        HttpResponse.json({ time: { created: new Date().toISOString() } }),
      ),
      http.get(`${NPM_DOWNLOADS}/fresh-and-unpopular`, () => HttpResponse.json({ downloads: 1 })),
    );

    const result = await scanDependencies([
      { identifier: 'ssg-test-not-a-real-package', ecosystem: 'npm' },
      { identifier: 'fresh-and-unpopular', ecosystem: 'npm' },
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.verdicts.find((v) => v.identifier === 'ssg-test-not-a-real-package')?.tier).toBe(
      'BLOCK',
    );
  });

  it('exits SUSPICIOUS (1) when the worst finding is a WARN', async () => {
    mockClean('totally-fine');
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/no-repo-link`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '1.0.0' },
              publishedAt: '2010-01-01T00:00:00Z',
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${DEPS_DEV}/systems/NPM/packages/no-repo-link/versions/1.0.0`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
    );
    // totally-fine already registered NPM_REGISTRY/downloads handlers via mockClean; reuse for no-repo-link too
    server.use(
      http.get(`${NPM_DOWNLOADS}/no-repo-link`, () => HttpResponse.json({ downloads: 999_999 })),
    );

    const result = await scanDependencies([
      { identifier: 'totally-fine', ecosystem: 'npm' },
      { identifier: 'no-repo-link', ecosystem: 'npm' },
    ]);

    expect(result.exitCode).toBe(1);
  });

  it('exits UNREACHABLE (3) when nothing else fires but a registry never answered', async () => {
    mockClean('totally-fine');
    mockUnreachable('flaky-case');

    const result = await scanDependencies([
      { identifier: 'totally-fine', ecosystem: 'npm' },
      { identifier: 'flaky-case', ecosystem: 'npm' },
    ]);

    expect(result.exitCode).toBe(3);
    expect(result.unreachable).toEqual([
      { identifier: 'flaky-case', ecosystem: 'npm', error: expect.any(String) },
    ]);
  });

  it('exits CLEAN (0) when everything resolves clean', async () => {
    mockClean('totally-fine');

    const result = await scanDependencies([{ identifier: 'totally-fine', ecosystem: 'npm' }]);

    expect(result.exitCode).toBe(0);
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0].tier).toBe('CLEAN');
  });

  it('passes each ecosystem its own popular-packages reference list', async () => {
    mockClean('some-lib');

    const result = await scanDependencies([{ identifier: 'some-lib', ecosystem: 'npm' }], {
      popularPackagesByEcosystem: { npm: ['some-lib-but-not-quite'] },
    });

    // 'some-lib' vs 'some-lib-but-not-quite' is far outside the default max distance (2),
    // so this just confirms the option plumbs through without throwing and without a false match.
    expect(result.verdicts[0].signals.some((s) => s.type === 'name-similarity')).toBe(false);
  });
});

describe('a limit shared by several scans (the editor extension opening a workspace)', () => {
  it('keeps all of them together under one bound, not one bound each', async () => {
    let inFlight = 0;
    let peak = 0;
    // Every name is a ghost: one deps.dev request each, held open briefly so they overlap.
    const fetchImpl: typeof fetch = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    };
    const manifest = (n: number) =>
      Array.from({ length: 6 }, (_, i) => ({
        identifier: `zz-ghost-${n}-${i}`,
        ecosystem: 'npm' as const,
      }));
    const limit = createScanLimit(3);

    const results = await Promise.all(
      [1, 2, 3, 4].map((n) => scanDependencies(manifest(n), { fetchImpl, limit })),
    );

    expect(results.every((r) => r.exitCode === 2)).toBe(true);
    expect(peak).toBe(3);
  });
});
