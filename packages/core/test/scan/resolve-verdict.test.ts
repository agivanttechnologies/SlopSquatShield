// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/cache/memory.js';
import { RegistryCache } from '../../src/cache/store.js';
import { buildLockfileIndex } from '../../src/resolvers/types.js';
import { resolveVerdict } from '../../src/scan/resolve-verdict.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;
const MAVEN_SEARCH = 'https://search.maven.org/solrsearch/select';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('resolveVerdict', () => {
  it('returns a CLEAN verdict for an allowlisted identifier, with zero network calls', async () => {
    const result = await resolveVerdict('sketchy-lib', 'npm', {
      allowlist: new Set(['sketchy-lib']),
    });

    expect(result).toEqual({
      kind: 'verdict',
      verdict: {
        identifier: 'sketchy-lib',
        ecosystem: 'npm',
        tier: 'CLEAN',
        signals: [],
        reason: 'Allowlisted in .slopsquatshield, so not checked.',
        // Marks "not evaluated", so surfaces can say "allowlisted" rather than "no findings".
        suppressedBy: 'allowlist',
      },
    });
  });

  it('still evaluates a name pinned in the lockfile (a lockfile can be edited by hand)', async () => {
    const lockfileIndex = buildLockfileIndex([{ name: 'young-pinned', version: '1.0.0' }]);
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/young-pinned`, () =>
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
      http.get(`${DEPS_DEV}/systems/NPM/packages/young-pinned/versions/1.0.0`, () =>
        HttpResponse.json({
          relatedProjects: [{ projectKey: { id: 'github.com/x/y' }, relationType: 'SOURCE_REPO' }],
        }),
      ),
      http.get(`${NPM_DOWNLOADS}/young-pinned`, () => HttpResponse.json({ downloads: 9_000_000 })),
    );

    const result = await resolveVerdict('young-pinned', 'npm', { lockfileIndex });

    // Brand new → WARN, exactly as if it were not pinned.
    expect(result.kind === 'verdict' && result.verdict.tier).toBe('WARN');
  });

  it('turns a pinned name that is not on the public registry into a WARN, not a BLOCK', async () => {
    const lockfileIndex = buildLockfileIndex([{ name: 'zz-ghost-pinned', version: '1.0.0' }]);
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/zz-ghost-pinned`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const result = await resolveVerdict('zz-ghost-pinned', 'npm', { lockfileIndex });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('WARN');
    expect(result.kind === 'verdict' && result.verdict.reason).toContain('Pinned in the lockfile');
  });

  it('the same name, unpinned, is still a BLOCK', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/zz-ghost-unpinned`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const result = await resolveVerdict('zz-ghost-unpinned', 'npm', {});

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('BLOCK');
  });

  it('is CLEAN for a pinned name that matches a declared private scope and is not public', async () => {
    const lockfileIndex = buildLockfileIndex([{ name: '@acme/internal', version: '1.0.0' }]);
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/%40acme%2Finternal`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const result = await resolveVerdict('@acme/internal', 'npm', {
      lockfileIndex,
      privateScope: { npmScopes: ['@acme'] },
    });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('CLEAN');
  });

  it('serves a pinned name from the cache with zero network calls once it has been checked', async () => {
    const cache = new MemoryCache();
    cache.set('npm', 'express', 'existence', {
      exists: true,
      firstPublishedAt: '2010-01-01T00:00:00Z',
      repoUrl: 'https://github.com/expressjs/express',
    });
    cache.set('npm', 'express', 'popularity', { weeklyDownloads: 25_000_000 });
    const lockfileIndex = buildLockfileIndex([{ name: 'express', version: '4.19.2' }]);

    // onUnhandledRequest: 'error' means any network call here would fail the test.
    const result = await resolveVerdict('express', 'npm', { lockfileIndex, cache });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('CLEAN');
  });

  it('reports a pinned name as unreachable, never clean, when nothing can be fetched or cached', async () => {
    const lockfileIndex = buildLockfileIndex([{ name: 'express', version: '4.19.2' }]);
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/express`, () => HttpResponse.error()),
      http.get(NPM_REGISTRY, () => HttpResponse.error()),
    );

    const result = await resolveVerdict('express', 'npm', { lockfileIndex });

    expect(result.kind).toBe('unreachable');
    expect(result.kind === 'unreachable' && result.error).toContain('pinned in the lockfile');
  });

  it('reports unreachable (not a verdict) when every source for the ecosystem fails', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/flaky-case`, () =>
        HttpResponse.json({ error: 'internal' }, { status: 503 }),
      ),
      http.get(NPM_REGISTRY, () => HttpResponse.json({ error: 'internal' }, { status: 503 })),
    );

    const result = await resolveVerdict('flaky-case', 'npm', {});

    expect(result.kind).toBe('unreachable');
  });

  it('serves a cache hit with zero network calls when both fact types are cached', async () => {
    const cache = new RegistryCache(':memory:');
    cache.set('npm', 'express', 'existence', {
      exists: true,
      firstPublishedAt: '2010-01-01T00:00:00Z',
      repoUrl: 'https://github.com/expressjs/express',
    });
    cache.set('npm', 'express', 'popularity', { weeklyDownloads: 25_000_000 });

    // onUnhandledRequest: 'error' means any network call here would fail the test.
    const result = await resolveVerdict('express', 'npm', { cache });

    expect(result.kind).toBe('verdict');
    expect(result.kind === 'verdict' && result.verdict.tier).toBe('CLEAN');
    cache.close();
  });

  it('uses Maven Central directly (not deps.dev) for maven, with no popularity cache lookup', async () => {
    server.use(
      http.get(MAVEN_SEARCH, () =>
        HttpResponse.json({
          response: { numFound: 1, docs: [{ v: '3.14.0', timestamp: 1697673600000 }] },
        }),
      ),
      http.get(
        'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.14.0/commons-lang3-3.14.0.pom',
        () =>
          HttpResponse.text(
            '<project><scm><url>https://github.com/apache/commons-lang</url></scm></project>',
          ),
      ),
    );

    const result = await resolveVerdict('org.apache.commons:commons-lang3', 'maven', {});

    expect(result.kind).toBe('verdict');
    expect(result.kind === 'verdict' && result.verdict.tier).toBe('CLEAN');
  });

  it('BLOCKs on dependency confusion once the registry confirms the name resolves publicly', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/%40myorg%2Finternal-tool`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '1.0.0' },
              publishedAt: '2020-01-01T00:00:00Z',
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${DEPS_DEV}/systems/NPM/packages/%40myorg%2Finternal-tool/versions/1.0.0`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
      http.get(NPM_REGISTRY, () =>
        HttpResponse.json({ time: { created: '2020-01-01T00:00:00.000Z' } }),
      ),
      http.get(`${NPM_DOWNLOADS}/%40myorg%2Finternal-tool`, () =>
        HttpResponse.json({ downloads: 999_999 }),
      ),
    );

    const result = await resolveVerdict('@myorg/internal-tool', 'npm', {
      privateScope: { npmScopes: ['@myorg'] },
    });

    expect(result.kind).toBe('verdict');
    expect(result.kind === 'verdict' && result.verdict.signals[0]?.type).toBe(
      'private-registry-mismatch',
    );
  });
});

describe('resolveVerdict: what the cache can answer on its own (#24)', () => {
  const PYPISTATS = 'https://pypistats.org/api/packages';
  let requests: string[];

  beforeEach(() => {
    requests = [];
    server.events.on('request:start', ({ request }) => requests.push(request.url));
  });
  afterEach(() => server.events.removeAllListeners());

  const OLD = '2010-01-01T00:00:00Z';

  it('BLOCKs a cached non-existent name with zero network calls (a ghost never has a downloads entry)', async () => {
    const cache = new MemoryCache();
    cache.set('npm', 'zz-ghost-cache-test', 'existence', { exists: false });

    const result = await resolveVerdict('zz-ghost-cache-test', 'npm', { cache });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('BLOCK');
    expect(requests).toEqual([]);
  });

  it('does the same for PyPI', async () => {
    const cache = new MemoryCache();
    cache.set('pypi', 'zz-ghost-py-cache-test', 'existence', { exists: false });

    const result = await resolveVerdict('zz-ghost-py-cache-test', 'pypi', { cache });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('BLOCK');
    expect(requests).toEqual([]);
  });

  it('fetches only the downloads figure when existence is cached but popularity is not, and caches it', async () => {
    const cache = new MemoryCache();
    cache.set('npm', 'express', 'existence', {
      exists: true,
      firstPublishedAt: OLD,
      repoUrl: 'https://github.com/expressjs/express',
    });
    server.use(
      http.get(`${NPM_DOWNLOADS}/express`, () => HttpResponse.json({ downloads: 25_000_000 })),
    );

    const result = await resolveVerdict('express', 'npm', { cache });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('CLEAN');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('api.npmjs.org/downloads/point/last-week/express');
    expect(cache.get('npm', 'express', 'popularity')).toEqual({ weeklyDownloads: 25_000_000 });
  });

  it('does the same for PyPI (pypistats only, never the package JSON)', async () => {
    const cache = new MemoryCache();
    cache.set('pypi', 'requests', 'existence', {
      exists: true,
      firstPublishedAt: OLD,
      repoUrl: 'https://github.com/psf/requests',
    });
    server.use(
      http.get(`${PYPISTATS}/requests/recent`, () =>
        HttpResponse.json({ data: { last_week: 50_000_000 } }),
      ),
    );

    const result = await resolveVerdict('requests', 'pypi', { cache });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('CLEAN');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('pypistats.org/api/packages/requests/recent');
  });

  it('still returns a verdict (not "unreachable") when that downloads lookup fails, and caches nothing', async () => {
    const cache = new MemoryCache();
    cache.set('npm', 'express', 'existence', {
      exists: true,
      firstPublishedAt: OLD,
      repoUrl: 'https://github.com/expressjs/express',
    });
    server.use(
      http.get(`${NPM_DOWNLOADS}/express`, () =>
        HttpResponse.json({ error: 'x' }, { status: 503 }),
      ),
    );

    const result = await resolveVerdict('express', 'npm', { cache });

    expect(result.kind).toBe('verdict');
    expect(result.kind === 'verdict' && result.verdict.signals.map((x) => x.type)).not.toContain(
      'popularity',
    );
    // A flaky lookup must not hide the low-downloads signal for the whole popularity TTL.
    expect(cache.get('npm', 'express', 'popularity')).toBeUndefined();
  });

  it('answers a cached Maven artifact with zero network calls', async () => {
    const cache = new MemoryCache();
    cache.set('maven', 'org.apache.commons:commons-lang3', 'existence', {
      exists: true,
      firstPublishedAt: OLD,
      repoUrl: 'https://github.com/apache/commons-lang',
    });

    const result = await resolveVerdict('org.apache.commons:commons-lang3', 'maven', { cache });

    expect(result.kind === 'verdict' && result.verdict.tier).toBe('CLEAN');
    expect(requests).toEqual([]);
  });
});
