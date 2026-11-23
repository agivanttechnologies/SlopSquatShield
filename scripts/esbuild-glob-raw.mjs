// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
// esbuild plugin shared by the CLI (tsup.config.ts) and the extension (esbuild.mjs).
// glob 14 and lru-cache 11 (reached through npm-registry-fetch) point their main entry at a
// minified build; glob's also inlines minimatch, path-scurry and others. Both publish the same code
// unminified as a `raw` export. Resolving `glob` and `lru-cache` to `<name>/raw` *from the importing
// file's own directory* keeps our bundles readable (NFR-4.3), keeps every inlined package visible
// for THIRD_PARTY_NOTICES.md, and picks the version that importer really depends on (a plain
// esbuild `alias` resolves from the working directory and can pick a different, older copy).
const RAW = /^(glob|lru-cache)$/;

export const globRaw = {
  name: 'unminified-raw-entries',
  setup(build) {
    build.onResolve({ filter: RAW }, (args) =>
      build.resolve(`${args.path}/raw`, {
        kind: args.kind,
        importer: args.importer,
        resolveDir: args.resolveDir,
      }),
    );
  },
};
