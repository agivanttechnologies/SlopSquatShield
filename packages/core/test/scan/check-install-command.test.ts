// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/cache/memory.js';
import { checkInstallCommand } from '../../src/scan/check-install-command.js';
import { at, memReader } from '../helpers/mem-reader.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  server.events.removeAllListeners();
});
afterAll(() => server.close());

let requests: string[];
beforeEach(() => {
  requests = [];
  server.events.on('request:start', ({ request }) => requests.push(request.url));
});

const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'app', dependencies: deps });
const missing = (name: string) =>
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );
const exists = (
  name: string,
  opts: { publishedAt?: string; repo?: boolean; downloads?: number } = {},
) =>
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({
        versions: [
          {
            versionKey: { version: '1.0.0' },
            publishedAt: opts.publishedAt ?? '2015-01-01T00:00:00Z',
            isDefault: true,
          },
        ],
      }),
    ),
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}/versions/1.0.0`, () =>
      HttpResponse.json({
        relatedProjects:
          opts.repo === false
            ? []
            : [{ projectKey: { id: `github.com/x/${name}` }, relationType: 'SOURCE_REPO' }],
      }),
    ),
    http.get(`${NPM_DOWNLOADS}/${name}`, () =>
      HttpResponse.json({ downloads: opts.downloads ?? 5_000_000 }),
    ),
  );

const base = () => ({ cwd: at(), homeDir: '/home/u', cache: new MemoryCache() });

describe('checkInstallCommand: a command that is not an install', () => {
  it.each(['ls -la', 'npm --version', 'npm test', 'echo "npm install x"'])(
    '%s: no reads, no requests',
    async (cmd) => {
      const reader = memReader({ [at('package.json')]: pkg({ 'zz-ghost': '1' }) });

      const out = await checkInstallCommand(cmd, { ...base(), reader });

      expect(out.recognized).toBe(false);
      expect(reader.reads).toEqual([]);
      expect(requests).toEqual([]);
    },
  );
});

describe('checkInstallCommand: manifest-driven installs (#25)', () => {
  it('BLOCKs a bare "npm install" when package.json lists a ghost, naming the file and command', async () => {
    missing('zz-ghost-manifest');
    const reader = memReader({ [at('package.json')]: pkg({ 'zz-ghost-manifest': '1.0.0' }) });

    const out = await checkInstallCommand('npm install', { ...base(), reader });

    const verdict = out.verdicts.find((v) => v.identifier === 'zz-ghost-manifest');
    expect(verdict?.tier).toBe('BLOCK');
    expect(verdict?.declaredIn).toBe('package.json');
    expect(verdict?.reason).toBe('Does not exist on the npm registry.');
    expect(out.manifestsChecked).toEqual(['package.json']);
  });

  it('follows "cd app && npm ci" to app/package.json', async () => {
    missing('zz-ghost-in-app');
    const reader = memReader({ [at('app', 'package.json')]: pkg({ 'zz-ghost-in-app': '1' }) });

    const out = await checkInstallCommand('cd app && npm ci', { ...base(), reader });

    expect(out.verdicts[0]?.tier).toBe('BLOCK');
  });

  it('WARNs on a risky manifest dependency, and is clean for an ordinary one', async () => {
    exists('brand-new', { publishedAt: new Date().toISOString() });
    exists('left-pad');
    const reader = memReader({ [at('package.json')]: pkg({ 'brand-new': '1', 'left-pad': '1' }) });

    const out = await checkInstallCommand('npm install', { ...base(), reader });

    expect(out.verdicts.find((v) => v.identifier === 'brand-new')?.tier).toBe('WARN');
    expect(out.verdicts.find((v) => v.identifier === 'left-pad')?.tier).toBe('CLEAN');
  });

  it('checks the manifest as well as a named package (npm installs the whole tree)', async () => {
    missing('zz-ghost-manifest');
    exists('express');
    const reader = memReader({ [at('package.json')]: pkg({ 'zz-ghost-manifest': '1' }) });

    const out = await checkInstallCommand('npm install express', { ...base(), reader });

    expect(out.verdicts.map((v) => v.identifier).sort()).toEqual(['express', 'zz-ghost-manifest']);
  });

  it('does not read a manifest for "npm install -g x"', async () => {
    exists('express');
    const reader = memReader({ [at('package.json')]: pkg({ 'zz-ghost': '1' }) });

    await checkInstallCommand('npm install -g express', { ...base(), reader });

    expect(reader.reads).toEqual([]);
  });

  it('respects the allowlist for a manifest dependency', async () => {
    const reader = memReader({ [at('package.json')]: pkg({ 'zz-ghost-allowed': '1' }) });

    const out = await checkInstallCommand('npm install', {
      ...base(),
      reader,
      allowlist: new Set(['zz-ghost-allowed']),
    });

    expect(out.verdicts[0]?.tier).toBe('CLEAN');
    expect(out.verdicts[0]?.suppressedBy).toBe('allowlist');
    expect(requests).toEqual([]);
  });

  it('never looks up the project’s own workspace members', async () => {
    exists('left-pad');
    const reader = memReader({
      [at('package.json')]: JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
      [at('packages', 'a', 'package.json')]: JSON.stringify({
        name: '@m/a',
        dependencies: { '@m/b': '*', 'left-pad': '1' },
      }),
      [at('packages', 'b', 'package.json')]: JSON.stringify({ name: '@m/b' }),
    });

    const out = await checkInstallCommand('npm ci', { ...base(), reader });

    expect(out.verdicts.map((v) => v.identifier)).toEqual(['left-pad']);
    expect(requests.some((u) => u.includes('%40m'))).toBe(false);
  });
});

describe('checkInstallCommand: fails open, and says so', () => {
  it('without file access, a manifest install is "not verified" rather than "no findings"', async () => {
    const out = await checkInstallCommand('npm install', { cwd: at() });
    expect(out.recognized).toBe(true);
    expect(out.notVerified.join(' ')).toContain('file access is not available');
  });

  it.each(['cd "$X" && npm ci', 'cd - && npm ci'])(
    '%s: the directory cannot be known, so it is reported not checked',
    async (cmd) => {
      const reader = memReader({ [at('package.json')]: pkg({ 'zz-ghost': '1' }) });
      const out = await checkInstallCommand(cmd, { ...base(), reader });
      expect(out.verdicts).toEqual([]);
      expect(out.notVerified.join(' ')).toContain('could not tell which directory');
    },
  );

  it('an unparseable manifest is reported, not thrown, and not treated as clean', async () => {
    const reader = memReader({ [at('package.json')]: '{ broken' });

    const out = await checkInstallCommand('npm install', { ...base(), reader });

    expect(out.manifestErrors).toHaveLength(1);
    expect(out.notVerified.join(' ')).toContain('could not parse');
  });

  it('a registry that never answers leaves the package unreachable, not clean', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/flaky`, () => HttpResponse.error()),
      http.get(/^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/, () => HttpResponse.error()),
    );
    const reader = memReader({ [at('package.json')]: pkg({ flaky: '1' }) });

    const out = await checkInstallCommand('npm install', { ...base(), reader });

    expect(out.unreachable.map((u) => u.identifier)).toEqual(['flaky']);
  });

  it('a spent time budget reports the remaining packages "not checked", never stalls', async () => {
    const reader = memReader({ [at('package.json')]: pkg({ a: '1', b: '1' }) });

    const out = await checkInstallCommand('npm install', { ...base(), reader, deadline: 0 });

    expect(out.unreachable).toHaveLength(2);
    expect(out.unreachable[0]?.error).toContain('time budget exceeded');
    expect(requests).toEqual([]);
  });
});

describe('checkInstallCommand: lockfile pins (#17)', () => {
  const lock = (names: string[]) =>
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {},
        ...Object.fromEntries(names.map((n) => [`node_modules/${n}`, { version: '1.0.0' }])),
      },
    });

  it('a ghost the lockfile also lists is a WARN, not a BLOCK', async () => {
    missing('zz-ghost-pinned');
    const reader = memReader({
      [at('package.json')]: pkg({ 'zz-ghost-pinned': '1' }),
      [at('package-lock.json')]: lock(['zz-ghost-pinned']),
    });

    const out = await checkInstallCommand('npm ci', { ...base(), reader });

    expect(out.verdicts[0]?.tier).toBe('WARN');
    expect(out.verdicts[0]?.reason).toContain('Pinned in the lockfile');
  });

  it('the lockfile is only read when something came back as not found', async () => {
    exists('left-pad');
    const reader = memReader({
      [at('package.json')]: pkg({ 'left-pad': '1' }),
      [at('package-lock.json')]: lock(['left-pad']),
    });

    await checkInstallCommand('npm ci', { ...base(), reader });

    expect(reader.reads).not.toContain(at('package-lock.json'));
  });

  it('an unpinned ghost stays a BLOCK even when a lockfile exists', async () => {
    missing('zz-ghost-unpinned');
    const reader = memReader({
      [at('package.json')]: pkg({ 'zz-ghost-unpinned': '1' }),
      [at('package-lock.json')]: lock(['something-else']),
    });

    const out = await checkInstallCommand('npm ci', { ...base(), reader });

    expect(out.verdicts[0]?.tier).toBe('BLOCK');
  });
});
