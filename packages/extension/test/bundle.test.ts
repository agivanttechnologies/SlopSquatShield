// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'ssg-ext-bundle-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('the shipped extension bundle', () => {
  it('loads in plain Node with no native module and no node_modules around it', () => {
    // Same options as esbuild.mjs. The bundle is written to an empty temp dir, so a top-level
    // require of anything not bundled (better-sqlite3, @slopsquatshield/core, …) would throw.
    const outfile = join(tmp, 'extension.cjs');
    buildSync({
      entryPoints: [resolve(__dirname, '../src/extension.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node18',
      outfile,
      external: ['vscode', 'better-sqlite3'],
      logLevel: 'silent',
    });

    // `vscode` only exists inside an editor: stand in a stub that tolerates any property access.
    const loader = join(tmp, 'load.cjs');
    writeFileSync(
      loader,
      `
      const Module = require('node:module');
      const deep = () => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : deep()), apply: () => deep(), construct: () => deep() });
      // esbuild's CJS interop copies the module's own properties, so the stub must be a real object.
      const stub = {};
      for (const name of ['DiagnosticSeverity', 'StatusBarAlignment', 'CodeActionKind', 'languages', 'window', 'workspace', 'commands', 'Range', 'Diagnostic', 'Uri', 'CodeAction', 'WorkspaceEdit']) stub[name] = deep();
      const original = Module._load;
      Module._load = function (request, ...rest) { return request === 'vscode' ? stub : original.call(this, request, ...rest); };
      const ext = require(${JSON.stringify(outfile)});
      console.log(JSON.stringify({ activate: typeof ext.activate, deactivate: typeof ext.deactivate }));
      `,
    );
    const out = execFileSync(process.execPath, [loader], { cwd: tmp, encoding: 'utf-8' });

    expect(JSON.parse(out.trim().split('\n').pop() ?? '{}')).toEqual({
      activate: 'function',
      deactivate: 'function',
    });
  });
});
