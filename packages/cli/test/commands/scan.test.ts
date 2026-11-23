// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runScan } from '../../src/commands/scan.js';
import { formatScanJson } from '../../src/format/json.js';
import { formatScanReport } from '../../src/format/scan.js';
import { plainStyle } from '../../src/format/style.js';
import { server } from '../msw/server.js';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/scan-project', import.meta.url));

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NOW_ISO = new Date().toISOString();
const OLD_ISO = '2010-01-01T00:00:00Z';

function mockDepsDev(name: string, publishedAt: string, hasRepo: boolean): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({
        versions: [{ versionKey: { version: '1.0.0' }, publishedAt, isDefault: true }],
      }),
    ),
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}/versions/1.0.0`, () =>
      HttpResponse.json({
        relatedProjects: hasRepo
          ? [{ projectKey: { id: `github.com/x/${name}` }, relationType: 'SOURCE_REPO' }]
          : [],
      }),
    ),
  );
}

function setUpFixtureMocks(): void {
  // ssg-test-not-a-real-package: 404 on deps.dev -> BLOCK (non-existence)
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/ssg-test-not-a-real-package`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );

  // fresh-lib: published today, popular, has a repo -> WARN (age alone)
  mockDepsDev('fresh-lib', NOW_ISO, true);

  // unpopular-lib: old, has a repo, but low downloads -> WARN (popularity alone)
  mockDepsDev('unpopular-lib', OLD_ISO, true);

  // no-repo-lib: old, popular, but no repo link -> WARN (missing-repo-link alone)
  mockDepsDev('no-repo-lib', OLD_ISO, false);

  server.use(
    http.get(NPM_REGISTRY, () => HttpResponse.json({ time: { created: OLD_ISO } })),
    http.get(`${NPM_DOWNLOADS}/fresh-lib`, () => HttpResponse.json({ downloads: 999_999 })),
    http.get(`${NPM_DOWNLOADS}/unpopular-lib`, () => HttpResponse.json({ downloads: 3 })),
    http.get(`${NPM_DOWNLOADS}/no-repo-lib`, () => HttpResponse.json({ downloads: 999_999 })),
  );
}

describe('runScan (1 BLOCK + 3 WARN fixture)', () => {
  it('exits HALLUCINATION (2) and reports exactly 4 findings', async () => {
    setUpFixtureMocks();

    const report = await runScan(FIXTURE_DIR, { cachePath: ':memory:' });

    expect(report.exitCode).toBe(2);
    expect(report.scannedCount).toBe(4);
    const findings = report.verdicts.filter((v) => v.tier !== 'CLEAN');
    expect(findings).toHaveLength(4);
    expect(findings.filter((f) => f.tier === 'BLOCK')).toHaveLength(1);
    expect(findings.filter((f) => f.tier === 'WARN')).toHaveLength(3);
  });

  it('both output formats list all 4 findings', async () => {
    setUpFixtureMocks();

    const report = await runScan(FIXTURE_DIR, { cachePath: ':memory:' });
    const table = formatScanReport(report, { style: plainStyle({ width: 120 }) });
    const json = formatScanJson(report);
    const parsed = JSON.parse(json);

    for (const name of [
      'ssg-test-not-a-real-package',
      'fresh-lib',
      'unpopular-lib',
      'no-repo-lib',
    ]) {
      expect(table).toContain(name);
    }
    expect(parsed.findings).toHaveLength(4);
    expect(parsed.exitCode).toBe(2);
    expect(parsed.findings.map((f: { identifier: string }) => f.identifier).sort()).toEqual(
      ['fresh-lib', 'ssg-test-not-a-real-package', 'no-repo-lib', 'unpopular-lib'].sort(),
    );
    // Sources are threaded through from the manifest that declared each package.
    expect(parsed.findings[0].sources[0]).toContain('package.json');
  });
});

describe('runScan — malformed manifests (NFR-3.3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ssg-scan-malformed-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports each unreadable manifest as file:line:column and keeps going — no stack trace', async () => {
    writeFileSync(join(dir, 'package.json'), '{\n  "dependencies": {\n    "a": "1",\n  }\n}');
    writeFileSync(join(dir, 'pyproject.toml'), '[project\ndependencies = [');
    writeFileSync(join(dir, 'pom.xml'), '<project><dependencies><dependency><groupId>a</groupId>');

    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(report.manifestErrors.map((e) => e.file.split(/[\\/]/).pop()).sort()).toEqual([
      'package.json',
      'pom.xml',
      'pyproject.toml',
    ]);
    expect(report.scannedCount).toBe(0);
    // Nothing readable → no finding, but nothing was *checked* either: "could not check" (3), never a
    // clean 0 that a CI job would read as a pass.
    expect(report.exitCode).toBe(3);

    const table = formatScanReport(report, { style: plainStyle({ width: 120 }) });
    expect(table).toContain('Could not read 3 manifests, so they were not checked:');
    expect(table).toContain('0 packages checked: 3 manifests skipped.');
    expect(table).toMatch(/package\.json:4:3: /);
    expect(table).not.toMatch(/\bat .*\(.*:\d+:\d+\)/); // no stack frames

    const json = JSON.parse(formatScanJson(report));
    expect(json.manifestErrors).toHaveLength(3);
    expect(json.manifestErrors[0]).toEqual(
      expect.objectContaining({
        file: expect.any(String),
        line: expect.any(Number),
        column: expect.any(Number),
      }),
    );
  });

  it('a malformed manifest does not stop the readable ones from being scanned', async () => {
    writeFileSync(join(dir, 'package.json'), '{ broken');
    writeFileSync(join(dir, 'requirements.txt'), 'allowlisted-only\n');
    writeFileSync(join(dir, '.slopsquatshield'), 'allowlisted-only\n');

    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(report.manifestErrors).toHaveLength(1);
    expect(report.scannedCount).toBe(1);
    expect(report.verdicts[0]?.tier).toBe('CLEAN');
    expect(report.exitCode).toBe(3); // the readable package is fine, but one manifest was not checked
  });
});
