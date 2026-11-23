// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** Shared MSW server: the extension's tests never touch a real registry. */
export const server = setupServer();

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;
const PYPI = 'PYPI';

/** deps.dev answers 404: the package does not exist → a BLOCK. */
export function mockMissingNpm(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );
}

export function mockMissingPypi(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/${PYPI}/packages/${name}`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );
}

/**
 * An old, popular package. `repo: false` drops the repository link, giving one WARN signal.
 * `downloads` (default 999,999 — established) matters for the look-alike signal, which core does
 * not raise for a package with 100,000+ weekly downloads: use a modest figure to model a typo-squat.
 */
export function mockHealthyNpm(
  name: string,
  options: { repo?: boolean; downloads?: number } = {},
): void {
  const repo = options.repo ?? true;
  const downloads = options.downloads ?? 999_999;
  const encoded = encodeURIComponent(name);
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${encoded}`, () =>
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
    http.get(`${DEPS_DEV}/systems/NPM/packages/${encoded}/versions/1.0.0`, () =>
      HttpResponse.json({
        relatedProjects: repo
          ? [{ projectKey: { id: `github.com/x/${name}` }, relationType: 'SOURCE_REPO' }]
          : [],
      }),
    ),
    http.get(NPM_REGISTRY, () =>
      HttpResponse.json({ time: { created: '2010-01-01T00:00:00.000Z' } }),
    ),
    http.get(`${NPM_DOWNLOADS}/${encoded}`, () => HttpResponse.json({ downloads })),
  );
}

/** Both deps.dev and the npm registry answer 503 → "registry unreachable", never a finding. */
export function mockDownNpm(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'internal' }, { status: 503 }),
    ),
    http.get(NPM_REGISTRY, () => HttpResponse.json({ error: 'internal' }, { status: 503 })),
  );
}
