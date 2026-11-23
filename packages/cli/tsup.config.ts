// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';
import { globRaw } from '../../scripts/esbuild-glob-raw.mjs';

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as {
  version: string;
};

/**
 * One self-contained file. Bundling everything (core included) is required to publish at all —
 * `@slopsquatshield/core` is a private workspace package — and it is also the latency fix: an
 * agent hook is a fresh process per tool call (NFR-2.2, warm < 300 ms), and resolving ~hundreds
 * of dependency files at startup cost seconds on a slow filesystem versus ~125 ms for one file.
 * Only `better-sqlite3` stays external: it is a native addon and can't be bundled.
 *
 * The `require` shim lets bundled CommonJS dependencies (cross-spawn, npm-registry-fetch, …)
 * run inside the ESM output. The bundle stays unminified (NFR-4.3).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  splitting: false,
  sourcemap: true,
  // `--version` must always equal the package version, so Changesets can't drift from the binary.
  define: { __SSG_VERSION__: JSON.stringify(version) },
  noExternal: [/.*/],
  external: ['better-sqlite3'],
  // Keep glob 14's code unminified (NFR-4.3); see scripts/esbuild-glob-raw.mjs.
  esbuildPlugins: [globRaw],
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __ssgCreateRequire } from 'node:module';",
      'const require = __ssgCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
