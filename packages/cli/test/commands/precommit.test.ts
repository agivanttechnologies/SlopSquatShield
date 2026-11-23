// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OVERRIDE_ORDER, listStagedFiles, runPrecommit } from '../../src/commands/precommit.js';
import { classifyManifests } from '../../src/discover-manifests.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'ssg-precommit-'));
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const write = (name: string, content: string) => {
  const path = join(repo, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};
const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'demo', dependencies: deps });

function mockMissing(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );
}
function mockHealthy(name: string, repoLink = true): void {
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
        relatedProjects: repoLink
          ? [{ projectKey: { id: `github.com/x/${name}` }, relationType: 'SOURCE_REPO' }]
          : [],
      }),
    ),
    http.get(NPM_REGISTRY, () =>
      HttpResponse.json({ time: { created: '2010-01-01T00:00:00.000Z' } }),
    ),
    http.get(`${NPM_DOWNLOADS}/${name}`, () => HttpResponse.json({ downloads: 999_999 })),
  );
}
function mockDown(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'internal' }, { status: 503 }),
    ),
    http.get(NPM_REGISTRY, () => HttpResponse.json({ error: 'internal' }, { status: 503 })),
  );
}

const run = (files: string[]) => runPrecommit(repo, files, { cachePath: ':memory:' });

describe('runPrecommit — only a BLOCK fails the commit (FR-20.3)', () => {
  it('BLOCK (a hallucinated package) → exit 2, with the override order printed', async () => {
    mockMissing('zz-ghost');
    write('package.json', pkg({ 'zz-ghost': '1' }));

    const result = await run(['package.json']);

    expect(result.exitCode).toBe(2);
    expect(result.scanExitCode).toBe(2);
    expect(result.output).toContain('blocked this commit');
    expect(result.output).toContain(OVERRIDE_ORDER);
  });

  it('WARN → printed, exit 0 (the commit goes ahead)', async () => {
    mockHealthy('no-repo-pkg', false);
    write('package.json', pkg({ 'no-repo-pkg': '1' }));

    const result = await run(['package.json']);

    expect(result.scanExitCode).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('No source repository listed');
    expect(result.output).toContain('the commit is not blocked');
  });

  it('registry unreachable → printed as "not a finding", exit 0', async () => {
    mockDown('flaky-pkg');
    write('package.json', pkg({ 'flaky-pkg': '1' }));

    const result = await run(['package.json']);

    expect(result.scanExitCode).toBe(3);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('not a finding');
  });

  it('clean → exit 0', async () => {
    mockHealthy('fine-pkg');
    write('package.json', pkg({ 'fine-pkg': '1' }));
    expect((await run(['package.json'])).exitCode).toBe(0);
  });

  it('always labels itself advisory and points at the real enforcement surfaces', async () => {
    mockHealthy('fine-pkg');
    write('package.json', pkg({ 'fine-pkg': '1' }));
    expect((await run(['package.json'])).output).toContain('This hook is advisory');
  });
});

describe('runPrecommit — staged files only (FR-20.2)', () => {
  it('does not scan a bad manifest that is not in the staged list', async () => {
    // No mock for zz-ghost: scanning it would be an unhandled request and fail the test.
    mockHealthy('fine-pkg');
    write('package.json', pkg({ 'fine-pkg': '1' }));
    write('other/package.json', pkg({ 'zz-ghost': '1' }));

    const result = await run(['package.json']);

    expect(result.exitCode).toBe(0);
    expect(result.scannedCount).toBe(1);
  });

  it('ignores staged files that are not manifests, and does nothing (no network) for them', async () => {
    write('src/app.ts', 'npm install zz-ghost');
    write('README.md', 'zz-ghost');
    const result = await run(['src/app.ts', 'README.md']);
    expect(result).toEqual({ exitCode: 0, scanExitCode: 0, output: '', scannedCount: 0 });
  });

  it('skips a staged path that no longer exists on disk', async () => {
    expect((await run(['deleted/package.json'])).scannedCount).toBe(0);
  });

  it('honours the project allowlist (FR-5.2)', async () => {
    write('.slopsquatshield', 'zz-ghost\n');
    write('package.json', pkg({ 'zz-ghost': '1' }));
    // No registry mock: the allowlist must short-circuit before any network call.
    expect((await run(['package.json'])).exitCode).toBe(0);
  });

  it('reports a malformed staged manifest and still does not fail the commit', async () => {
    write('package.json', '{ broken');
    const result = await run(['package.json']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Could not read 1 manifest, so it was not checked:');
  });
});

describe('classifyManifests', () => {
  it('sorts an explicit file list into the same buckets discovery uses', () => {
    const m = classifyManifests([
      '/r/package.json',
      '/r/a/requirements.txt',
      '/r/pom.xml',
      '/r/package-lock.json',
      '/r/readme.md',
    ]);
    expect(m.packageJson).toEqual(['/r/package.json']);
    expect(m.requirementsTxt).toEqual(['/r/a/requirements.txt']);
    expect(m.pomXml).toEqual(['/r/pom.xml']);
    expect(m.packageLockJson).toEqual(['/r/package-lock.json']);
  });
});

describe('listStagedFiles', () => {
  const git = (args: string[], cwd: string) =>
    execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

  it('returns exactly the staged, still-present files from a real git repository', () => {
    git(['init', '-q'], repo);
    git(['config', 'user.email', 't@example.com'], repo);
    git(['config', 'user.name', 'Test'], repo);
    write('keep.txt', 'a');
    write('package.json', pkg({}));
    git(['add', '.'], repo);
    git(['commit', '-q', '-m', 'init'], repo);

    write('package.json', pkg({ x: '1' })); // modified and staged
    write('requirements.txt', 'flask\n'); // added and staged
    write('untracked.txt', 'not staged');
    git(['add', 'package.json', 'requirements.txt'], repo);
    git(['rm', '-q', '--cached', 'keep.txt'], repo); // staged deletion must be excluded

    const { files, root } = listStagedFiles(join(repo, '.'));

    expect(files.sort()).toEqual(['package.json', 'requirements.txt']);
    expect(root.replace(/\\/g, '/')).toContain('ssg-precommit-');
  });
});
