// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPrecommit } from '../../src/commands/precommit.js';
import { runScan } from '../../src/commands/scan.js';
import { formatScanJson } from '../../src/format/json.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssg-scan-exit3-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('an unparseable manifest is "could not check" (exit 3), not a clean 0 (#18)', () => {
  it('a project whose only manifest is broken exits 3, in the JSON too', async () => {
    writeFileSync(join(dir, 'package.json'), '{\n  "dependencies": {\n    "left-pad": "1.3.0"\n\n');

    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(report.exitCode).toBe(3);
    const json = JSON.parse(formatScanJson(report));
    expect(json.exitCode).toBe(3);
    expect(json.manifestErrors).toHaveLength(1);
  });

  it('a BLOCK elsewhere still wins: the exit code is 2', async () => {
    writeFileSync(join(dir, 'package.json'), '{ broken');
    writeFileSync(join(dir, 'requirements.txt'), 'zz-ghost-exit3\n');
    server.use(
      http.get('https://pypi.org/pypi/zz-ghost-exit3/json', () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get(`${DEPS_DEV}/systems/PYPI/packages/zz-ghost-exit3`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const report = await runScan(dir, { cachePath: ':memory:' });

    expect(report.exitCode).toBe(2);
    expect(report.manifestErrors).toHaveLength(1);
  });

  it('the pre-commit hook still lets the commit through, and says why nothing was checked', async () => {
    writeFileSync(join(dir, 'package.json'), '{ broken');

    const result = await runPrecommit(dir, ['package.json'], { cachePath: ':memory:' });

    expect(result.exitCode).toBe(0);
    expect(result.scanExitCode).toBe(3);
    expect(result.output).toContain('a staged manifest could not be parsed');
    expect(result.output).toContain('not checked');
    expect(result.output).not.toContain('registry was unreachable');
  });
});
