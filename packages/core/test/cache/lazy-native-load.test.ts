// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'ssg-lazy-native-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('core engine bundle without the native SQLite module', () => {
  it('loads and runs under plain Node when better-sqlite3 is not installed', () => {
    // Mirrors how the editor extension bundles core: one CJS file, better-sqlite3 left
    // external. The bundle lives in a temp dir with no node_modules above it, so a
    // top-level require('better-sqlite3') would throw at load time.
    const outfile = join(tmp, 'engine.cjs');
    buildSync({
      entryPoints: [resolve(__dirname, '../../src/index.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      outfile,
      external: ['better-sqlite3'],
      logLevel: 'silent',
    });

    const script = `
      const core = require(${JSON.stringify(outfile)});
      const cache = new core.MemoryCache();
      cache.set('npm', 'x', 'existence', { exists: true });
      let sqliteError = '';
      try { new core.RegistryCache(':memory:'); } catch (e) { sqliteError = String(e.code || e.message); }
      console.log(JSON.stringify({
        hasEngine: typeof core.scanDependencies === 'function',
        memoryHit: cache.get('npm', 'x', 'existence'),
        sqliteError,
      }));
    `;
    const out = execFileSync(process.execPath, ['-e', script], { cwd: tmp, encoding: 'utf-8' });
    const result = JSON.parse(out.trim().split('\n').pop() ?? '{}');

    expect(result.hasEngine).toBe(true);
    expect(result.memoryHit).toEqual({ exists: true });
    // Only constructing the SQLite cache needs the native module — and only then does it fail.
    expect(result.sqliteError).toMatch(/MODULE_NOT_FOUND|Cannot find module/);
  });

  it('still constructs the SQLite cache from an ESM bundle (the CLI build shape)', () => {
    // Regression: esbuild's ESM output injects a throwing `require` shim, so a loader that
    // tested `typeof require` first broke every CLI hook ("Dynamic require ... not supported").
    // The bundle sits inside the repo so the real, installed better-sqlite3 is resolvable.
    const outfile = join(__dirname, `.esm-bundle-${process.pid}.mjs`);
    try {
      buildSync({
        entryPoints: [resolve(__dirname, '../../src/index.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile,
        external: ['better-sqlite3'],
        logLevel: 'silent',
      });
      const script = `
        import(${JSON.stringify(pathToFileURL(outfile).href)}).then((core) => {
          const cache = new core.RegistryCache(':memory:');
          cache.set('npm', 'x', 'existence', { exists: true });
          console.log(JSON.stringify(cache.get('npm', 'x', 'existence')));
          cache.close();
        });
      `;
      const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf-8' });
      expect(JSON.parse(out.trim().split('\n').pop() ?? 'null')).toEqual({ exists: true });
    } finally {
      rmSync(outfile, { force: true });
    }
  });
});
