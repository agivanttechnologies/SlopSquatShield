// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathWithoutShimDir, runInstallWrapper } from '../../src/commands/install-wrapper.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Every test runs in its own empty project directory. Without it the wrapper would read whatever
// package.json happens to sit above the test runner's cwd — implicit machine state.
let projectDir: string;
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ssg-wrapper-'));
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

function fakeSpawn(exitCode = 0) {
  const spawnImpl = vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { kill?: () => void };
    queueMicrotask(() => child.emit('exit', exitCode, null));
    return child;
  });
  return spawnImpl as unknown as typeof import('cross-spawn');
}

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

describe('runInstallWrapper', () => {
  it('BLOCKs a nonexistent package and never forwards to the real npm (FR-9.2)', async () => {
    mockNonexistent('this-package-does-not-exist-xyz');
    const spawnImpl = fakeSpawn();

    const code = await runInstallWrapper('npm', ['install', 'this-package-does-not-exist-xyz'], {
      cachePath: ':memory:',
      cwd: projectDir,
      spawnImpl,
    });

    expect(code).toBe(2);
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('forwards a clean install to the real npm and returns its exit code', async () => {
    mockClean('express');
    const spawnImpl = fakeSpawn(0);

    const code = await runInstallWrapper('npm', ['install', 'express'], {
      cachePath: ':memory:',
      cwd: projectDir,
      spawnImpl,
    });

    expect(code).toBe(0);
    expect(spawnImpl).toHaveBeenCalledWith(
      'npm',
      ['install', 'express'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('proceeds on a WARN-only finding (FR-9.3: WARN never blocks non-interactively)', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/no-repo-lib`, () =>
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
      http.get(`${DEPS_DEV}/systems/NPM/packages/no-repo-lib/versions/1.0.0`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
      http.get(NPM_REGISTRY, () =>
        HttpResponse.json({ time: { created: '2010-01-01T00:00:00.000Z' } }),
      ),
      http.get(`${NPM_DOWNLOADS}/no-repo-lib`, () => HttpResponse.json({ downloads: 999_999 })),
    );
    const spawnImpl = fakeSpawn(0);

    const code = await runInstallWrapper('npm', ['install', 'no-repo-lib'], {
      cachePath: ':memory:',
      cwd: projectDir,
      spawnImpl,
    });

    expect(code).toBe(0);
    expect(spawnImpl).toHaveBeenCalled();
  });

  it('passes through a non-install subcommand with zero registry calls (FR-9.4)', async () => {
    // onUnhandledRequest: 'error' means any registry call here would fail the test.
    const spawnImpl = fakeSpawn(0);

    const code = await runInstallWrapper('npm', ['run', 'build'], {
      cachePath: ':memory:',
      cwd: projectDir,
      spawnImpl,
    });

    expect(code).toBe(0);
    expect(spawnImpl).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.objectContaining({ stdio: 'inherit' }),
    );
  });

  it('passes through a bare "npm install" in a project with no manifest, with zero registry calls', async () => {
    const spawnImpl = fakeSpawn(0);

    const code = await runInstallWrapper('npm', ['install'], {
      cachePath: ':memory:',
      cwd: projectDir,
      spawnImpl,
    });

    expect(code).toBe(0);
    expect(spawnImpl).toHaveBeenCalled();
  });

  describe('installs driven by the project manifest (#25)', () => {
    const manifest = (deps: Record<string, string>) =>
      writeFileSync(
        join(projectDir, 'package.json'),
        JSON.stringify({ name: 'app', dependencies: deps }),
      );

    it('BLOCKs a bare "npm install" when package.json lists a ghost, and never forwards it', async () => {
      manifest({ 'zz-ghost-from-manifest': '1.0.0' });
      mockNonexistent('zz-ghost-from-manifest');
      const spawnImpl = fakeSpawn();

      const code = await runInstallWrapper('npm', ['install'], {
        cachePath: ':memory:',
        cwd: projectDir,
        spawnImpl,
      });

      expect(code).toBe(2);
      expect(spawnImpl).not.toHaveBeenCalled();
    });

    it('does the same for "npm ci"', async () => {
      manifest({ 'zz-ghost-from-manifest': '1.0.0' });
      mockNonexistent('zz-ghost-from-manifest');
      const spawnImpl = fakeSpawn();

      const code = await runInstallWrapper('npm', ['ci'], {
        cachePath: ':memory:',
        cwd: projectDir,
        spawnImpl,
      });

      expect(code).toBe(2);
      expect(spawnImpl).not.toHaveBeenCalled();
    });

    it('also checks the manifest when a clean package is named (npm installs the whole tree)', async () => {
      manifest({ 'zz-ghost-from-manifest': '1.0.0' });
      mockNonexistent('zz-ghost-from-manifest');
      mockClean('express');
      const spawnImpl = fakeSpawn();

      const code = await runInstallWrapper('npm', ['install', 'express'], {
        cachePath: ':memory:',
        cwd: projectDir,
        spawnImpl,
      });

      expect(code).toBe(2);
      expect(spawnImpl).not.toHaveBeenCalled();
    });

    it('forwards a bare install whose manifest is all clean', async () => {
      manifest({ express: '^4.0.0' });
      mockClean('express');
      const spawnImpl = fakeSpawn(0);

      const code = await runInstallWrapper('npm', ['install'], {
        cachePath: ':memory:',
        cwd: projectDir,
        spawnImpl,
      });

      expect(code).toBe(0);
      expect(spawnImpl).toHaveBeenCalled();
    });

    it('does not check anything for "npm install -g <pkg>" beyond the package named', async () => {
      manifest({ 'zz-ghost-from-manifest': '1.0.0' }); // would BLOCK if the manifest were read
      mockClean('express');
      const spawnImpl = fakeSpawn(0);

      const code = await runInstallWrapper('npm', ['install', '-g', 'express'], {
        cachePath: ':memory:',
        cwd: projectDir,
        spawnImpl,
      });

      expect(code).toBe(0);
    });

    it('fails open on an unparseable manifest, and says it was not checked', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{ broken');
      const spawnImpl = fakeSpawn(0);
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      try {
        const code = await runInstallWrapper('npm', ['install'], {
          cachePath: ':memory:',
          cwd: projectDir,
          spawnImpl,
        });

        expect(code).toBe(0);
        expect(spawnImpl).toHaveBeenCalled();
        const written = stderr.mock.calls.map((c) => String(c[0])).join('');
        expect(written).toContain('could not parse');
        expect(written).toContain('not checked');
      } finally {
        stderr.mockRestore();
      }
    });
  });

  it("propagates the real package manager's own non-zero exit code on a clean install", async () => {
    mockClean('express');
    const spawnImpl = fakeSpawn(7);

    const code = await runInstallWrapper('npm', ['install', 'express'], {
      cachePath: ':memory:',
      cwd: projectDir,
      spawnImpl,
    });

    expect(code).toBe(7);
  });
});

describe('pathWithoutShimDir (CI shim recursion fix)', () => {
  const sep = process.platform === 'win32' ? ';' : ':';

  it('removes the shim dir from PATH so the wrapper reaches the real tool, not the shim', () => {
    const env = {
      SLOPSQUATSHIELD_SHIM_DIR: '/ci/shims',
      PATH: ['/ci/shims', '/usr/local/bin', '/usr/bin'].join(sep),
    };
    expect(pathWithoutShimDir(env)).toBe(['/usr/local/bin', '/usr/bin'].join(sep));
  });

  it('leaves PATH alone when no shim dir is exported', () => {
    expect(pathWithoutShimDir({ PATH: ['/a', '/b'].join(sep) })).toBe(['/a', '/b'].join(sep));
  });

  it('forwards to the real tool with the shim dir stripped from the spawned env', async () => {
    const spawnImpl = fakeSpawn();
    const before = { ...process.env };
    process.env.SLOPSQUATSHIELD_SHIM_DIR = '/ci/shims';
    process.env.PATH = ['/ci/shims', '/usr/bin'].join(sep);
    try {
      await runInstallWrapper('npm', ['--version'], { cwd: projectDir, spawnImpl });
      const options = (spawnImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][2];
      expect(options.env.PATH).toBe('/usr/bin');
    } finally {
      process.env = before;
    }
  });
});

describe('runInstallWrapper — unreachable registry (NFR-3.1)', () => {
  it('fails open: still forwards to the real tool, and says it could not verify', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/flaky-wrapper-pkg`, () =>
        HttpResponse.json({ error: 'internal' }, { status: 503 }),
      ),
      http.get(NPM_REGISTRY, () => HttpResponse.json({ error: 'internal' }, { status: 503 })),
    );
    const spawnImpl = fakeSpawn(0);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const code = await runInstallWrapper('npm', ['install', 'flaky-wrapper-pkg'], {
        cachePath: ':memory:',
        cwd: projectDir,
        spawnImpl,
      });

      expect(code).toBe(0);
      expect(spawnImpl).toHaveBeenCalled();
      const written = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(written).toContain('could not reach the registry to verify flaky-wrapper-pkg');
    } finally {
      stderr.mockRestore();
    }
  });
});
