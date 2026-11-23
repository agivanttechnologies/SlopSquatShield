// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { isAbsolute, relative, sep } from 'node:path';

export interface DisplayPathContext {
  /** The directory the person ran the command from. */
  cwd: string;
  /** Their home directory. Always passed in: never read from the OS here (tests must not touch it). */
  home: string;
}

/** True when `child` is `parent` or inside it. */
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * A path the way a person wants to read it: relative to where they are when it's inside that
 * directory (`package.json`, `apps/web/package.json`), `~/…` when it's under their home, and
 * absolute otherwise. A path that isn't absolute is already relative and is returned unchanged.
 */
export function displayPath(path: string, ctx: DisplayPathContext): string {
  if (!isAbsolute(path)) return path;
  if (within(ctx.cwd, path)) return relative(ctx.cwd, path) || '.';
  if (ctx.home && within(ctx.home, path)) {
    const rest = relative(ctx.home, path);
    return rest ? `~${sep}${rest}` : '~';
  }
  return path;
}
