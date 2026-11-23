// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runScan } from '../../src/commands/scan.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssg-scan-lock-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(rel: string, content: unknown): void {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
}

describe('runScan and lockfiles (#17)', () => {
  it('does not trust a hand-edited lockfile: a ghost it lists is a WARN, not "0 findings"', async () => {
    write('package.json', { name: 'app', dependencies: { 'zz-ghost-pinned-cli': '1.0.0' } });
    write('package-lock.json', {
      lockfileVersion: 3,
      packages: { '': {}, 'node_modules/zz-ghost-pinned-cli': { version: '1.0.0' } },
    });
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/zz-ghost-pinned-cli`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(report.exitCode).toBe(1);
    const verdict = report.verdicts.find((v) => v.identifier === 'zz-ghost-pinned-cli');
    expect(verdict?.tier).toBe('WARN');
    expect(verdict?.reason).toContain('Pinned in the lockfile');
  });

  it('does not look up the project’s own workspace members or file:/link: dependencies', async () => {
    write('package.json', { name: 'mono', private: true, workspaces: ['packages/*'] });
    write('packages/a/package.json', {
      name: '@mono/a',
      dependencies: { '@mono/b': '*', 'left-pad': '^1.3.0', 'local-thing': 'file:../local' },
    });
    write('packages/b/package.json', { name: '@mono/b' });
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(request.url));
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/left-pad`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '1.3.0' },
              publishedAt: '2016-01-01T00:00:00Z',
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${DEPS_DEV}/systems/NPM/packages/left-pad/versions/1.3.0`, () =>
        HttpResponse.json({
          relatedProjects: [{ projectKey: { id: 'github.com/x/y' }, relationType: 'SOURCE_REPO' }],
        }),
      ),
      http.get(`${NPM_DOWNLOADS}/left-pad`, () => HttpResponse.json({ downloads: 1_000_000 })),
    );

    const report = await runScan(dir, { cachePath: ':memory:' });
    server.events.removeAllListeners();

    expect(report.scannedCount).toBe(1);
    expect(report.exitCode).toBe(0);
    expect(asked.filter((u) => u.includes('mono') || u.includes('local-thing'))).toEqual([]);
  });
});
