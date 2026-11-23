// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInstallWrapper } from '../../src/commands/install-wrapper.js';
import { runScan } from '../../src/commands/scan.js';
import { formatScanJson } from '../../src/format/json.js';
import { formatScanReport } from '../../src/format/scan.js';
import { runHookCheckFromStdin } from '../../src/hooks/hook-runner.js';
import { loadProjectContext } from '../../src/project-context.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssg-config-wiring-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** A package with a repo and plenty of downloads, first published `ageDays` ago. */
function mockPackage(name: string, ageDays: number): void {
  const encoded = encodeURIComponent(name);
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${encoded}`, () =>
      HttpResponse.json({
        versions: [
          { versionKey: { version: '1.0.0' }, publishedAt: daysAgo(ageDays), isDefault: true },
        ],
      }),
    ),
    http.get(`${DEPS_DEV}/systems/NPM/packages/${encoded}/versions/1.0.0`, () =>
      HttpResponse.json({
        relatedProjects: [
          { projectKey: { id: `github.com/x/${name}` }, relationType: 'SOURCE_REPO' },
        ],
      }),
    ),
    http.get(NPM_REGISTRY, () => HttpResponse.json({ time: { created: daysAgo(ageDays) } })),
    // The client URL-encodes the name (`@acme/x` -> `%40acme%2Fx`); the handler must match that.
    http.get(`${NPM_DOWNLOADS}/${encoded}`, () => HttpResponse.json({ downloads: 999_999 })),
  );
}

function mockMissing(name: string): void {
  const encoded = encodeURIComponent(name);
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${encoded}`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );
}

const writePackageJson = (deps: Record<string, string>, extra: object = {}) =>
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: deps, ...extra }),
  );

describe('loadProjectContext', () => {
  it('reads the allowlist and the config from one directory', () => {
    writeFileSync(join(dir, '.slopsquatshield'), '# mine\nfoo\n');
    writeFileSync(join(dir, '.slopsquatshieldrc'), '{"thresholds":{"minAgeDays":3}}');

    const ctx = loadProjectContext(dir);

    expect([...(ctx.allowlist ?? [])]).toEqual(['foo']);
    expect(ctx.config.thresholds?.minAgeDays).toBe(3);
    expect(ctx.configWarning).toBeUndefined();
  });

  it('is empty for a bare directory', () => {
    expect(loadProjectContext(dir)).toEqual({
      allowlist: undefined,
      config: {},
      configWarning: undefined,
    });
  });

  it('reads the slopsquatshield key from package.json', () => {
    writePackageJson({}, { slopsquatshield: { thresholds: { minWeeklyDownloads: 9 } } });
    expect(loadProjectContext(dir).config.thresholds?.minWeeklyDownloads).toBe(9);
  });

  it('a broken config yields defaults and a located warning, never a throw', () => {
    writeFileSync(join(dir, '.slopsquatshieldrc'), '{"thresholds":{"minAgeDays":"soon"}}');
    const ctx = loadProjectContext(dir);
    expect(ctx.config).toEqual({});
    expect(ctx.configWarning).toContain('.slopsquatshieldrc:1:');
  });
});

describe('scan honours the project config (FR-4.1)', () => {
  it('the same 21-day-old package is clean by default and a WARN under minAgeDays: 30', async () => {
    mockPackage('cfg-pkg', 21);
    writePackageJson({ 'cfg-pkg': '1.0.0' });

    const normal = await runScan(dir, { cachePath: ':memory:' });
    expect(normal.verdicts[0].tier).toBe('CLEAN');

    writeFileSync(join(dir, '.slopsquatshieldrc'), '{"thresholds":{"minAgeDays":30}}');
    const strict = await runScan(dir, { cachePath: ':memory:' });
    expect(strict.verdicts[0].tier).toBe('WARN');
    expect(strict.exitCode).toBe(1);
  });

  it('a private npm scope makes a public hit a dependency-confusion BLOCK (FR-6.1)', async () => {
    mockPackage('@acme/internal-ui', 400);
    writePackageJson({ '@acme/internal-ui': '1.0.0' });
    writeFileSync(join(dir, '.slopsquatshieldrc'), '{"privateScopes":{"npm":["@acme"]}}');

    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(report.verdicts[0].tier).toBe('BLOCK');
    expect(report.exitCode).toBe(2);
  });

  it('a broken config warns on stderr and the scan still runs on defaults', async () => {
    mockPackage('cfg-pkg', 21);
    writePackageJson({ 'cfg-pkg': '1.0.0' });
    writeFileSync(join(dir, '.slopsquatshieldrc'), '{ not json');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      const report = await runScan(dir, { cachePath: ':memory:' });
      expect(report.verdicts[0].tier).toBe('CLEAN');
      const out = stderr.mock.calls.map((c) => String(c[0])).join('');
      expect(out).toContain('Ignoring the SlopSquatShield configuration');
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('--report-only output (FR-18)', () => {
  it('the table says it is report-only and what the normal exit code would have been', async () => {
    mockMissing('zz-ghost');
    writePackageJson({ 'zz-ghost': '1' });
    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(report.exitCode).toBe(2);
    expect(formatScanReport(report, { reportOnly: true })).toContain(
      'Report-only: exiting 0 (a normal scan would have exited 2)',
    );
    expect(formatScanReport(report)).not.toContain('Report-only');
  });

  it('the JSON keeps the real exitCode and flags reportOnly', async () => {
    mockMissing('zz-ghost');
    writePackageJson({ 'zz-ghost': '1' });
    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(JSON.parse(formatScanJson(report, { reportOnly: true }))).toMatchObject({
      exitCode: 2,
      reportOnly: true,
    });
    expect(JSON.parse(formatScanJson(report)).reportOnly).toBe(false);
  });
});

describe('the other surfaces read the same allowlist and config (FR-5.2)', () => {
  it('the agent hook applies the project allowlist from the host cwd', async () => {
    writeFileSync(join(dir, '.slopsquatshield'), 'zz-ghost\n');
    const stdinText = JSON.stringify({
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'npm install zz-ghost' },
    });
    // No registry mock: only the allowlist can short-circuit this.
    const result = await runHookCheckFromStdin({ stdinText, cachePath: ':memory:' });
    expect(result.decision).toBe('allow');
  });

  it('the agent hook applies the project config too', async () => {
    mockPackage('cfg-pkg', 21);
    writeFileSync(join(dir, '.slopsquatshieldrc'), '{"thresholds":{"minAgeDays":30}}');
    const stdinText = JSON.stringify({
      cwd: dir,
      tool_name: 'Bash',
      tool_input: { command: 'npm install cfg-pkg' },
    });
    const result = await runHookCheckFromStdin({ stdinText, cachePath: ':memory:' });
    expect(result.decision).toBe('ask'); // WARN
  });

  it('the install wrapper now honours .slopsquatshield (it ignored it before)', async () => {
    writeFileSync(join(dir, '.slopsquatshield'), 'zz-ghost\n');
    const spawnImpl = vi.fn(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    }) as unknown as typeof import('cross-spawn');

    // zz-ghost has no registry mock: without the allowlist this would BLOCK or hit the network.
    const code = await runInstallWrapper('npm', ['install', 'zz-ghost'], {
      cachePath: ':memory:',
      spawnImpl,
      cwd: dir,
    });

    expect(code).toBe(0);
    expect(spawnImpl).toHaveBeenCalled();
  });

  it('the install wrapper applies the project config', async () => {
    mockPackage('cfg-pkg', 400);
    writeFileSync(join(dir, '.slopsquatshieldrc'), '{"privateScopes":{"npm":["@acme"]}}');
    mockPackage('@acme/internal-ui', 400);
    const spawnImpl = vi.fn() as unknown as typeof import('cross-spawn');

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await runInstallWrapper('npm', ['install', '@acme/internal-ui'], {
        cachePath: ':memory:',
        spawnImpl,
        cwd: dir,
      });
      expect(code).toBe(2);
      expect(spawnImpl).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });
});
