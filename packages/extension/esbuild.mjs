// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
// Bundles the extension and `@slopsquatshield/core` into one unminified CommonJS file.
// Only `vscode` (provided by the host) and the native `better-sqlite3` stay external — the
// extension uses core's in-memory cache and never loads SQLite, so no native module ships.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { globRaw } from '../../scripts/esbuild-glob-raw.mjs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18', // the Electron 25 / Node 18 floor of VS Code 1.85
  outfile: 'dist/extension.js',
  external: ['vscode', 'better-sqlite3'],
  // Keep glob 14's code unminified (NFR-4.3); see scripts/esbuild-glob-raw.mjs.
  plugins: [globRaw],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  // The extension's version, for the User-Agent its registry requests send.
  define: { __SSG_VERSION__: JSON.stringify(version) },
  // core's bundled loader reads `typeof import.meta.url === "string" && import.meta.url ? … : __require`.
  // In this CommonJS bundle `import.meta` is empty, so that guard is false and it takes the
  // `__require` branch by design — esbuild's warning about it is expected noise that was burying
  // real warnings. Any other warning still shows.
  logOverride: { 'empty-import-meta': 'silent' },
});
