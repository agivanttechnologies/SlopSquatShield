// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where the running CLI lives — what the generated launcher records and execs. */
export interface SelfLocation {
  /** Absolute path of the Node binary that should run the CLI. */
  nodePath: string;
  /** Absolute, symlink-resolved path of the bundled CLI entry (`dist/index.js`). */
  entryPath: string;
  /**
   * True when the entry sits in a throwaway cache (`npx`, `pnpm dlx`, `bunx`) — a launcher
   * pointing there would break as soon as the cache is pruned, so `init` refuses to write one.
   */
  ephemeral: boolean;
}

const EPHEMERAL_SEGMENTS = ['_npx', 'dlx', '.bun/install/cache', 'fnm_multishells'];

export function isEphemeralPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return EPHEMERAL_SEGMENTS.some((segment) => normalized.includes(`/${segment}/`));
}

/**
 * Resolves the running CLI's own location. `import.meta.url` is the bundled `dist/index.js`
 * (tsup emits a single file), and `realpathSync` follows `npm link`/pnpm/global symlinks so
 * the recorded path is the real file. Injectable (see `InitOptions.selfLocation`) so tests
 * never depend on where the test runner happens to live.
 */
export function detectSelfLocation(): SelfLocation {
  const entryPath = realpathSync(fileURLToPath(import.meta.url));
  // fnm hands each shell a throwaway `fnm_multishells/<id>` symlink to the real Node —
  // resolve it. Other managers' paths (nvm, volta, Homebrew's /opt/homebrew/bin) are stable
  // or self-updating symlinks, which is what we want recorded.
  let nodePath = process.execPath;
  if (isEphemeralPath(nodePath)) nodePath = realpathSync(nodePath);
  return { nodePath, entryPath, ephemeral: isEphemeralPath(entryPath) };
}
