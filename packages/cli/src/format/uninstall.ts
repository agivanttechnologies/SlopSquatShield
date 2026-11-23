// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { UninstallResult } from '../commands/uninstall.js';
import { type DisplayPathContext, displayPath } from './paths.js';
import { type Style, createStyle, creditLines } from './style.js';

/**
 * What `uninstall` removed (or, in a dry run, would remove), what it could not remove safely, and
 * what it deliberately left alone. Returns the text only; the exit code comes from `result.ok`.
 */
export function formatUninstallResult(
  result: UninstallResult,
  options: { paths: DisplayPathContext; style?: Style },
): string {
  const style = options.style ?? createStyle(process.stdout);
  // `/home/me/.bashrc` -> `~/.bashrc`, so the report doesn't spell out long absolute paths.
  const shorten = (path: string) => displayPath(path, options.paths);
  const line = (mark: string, surface: string, detail: string) =>
    `  ${mark} ${surface.padEnd(30)} ${detail}`;
  const removed = result.actions.filter((a) => a.outcome === 'removed');
  const stuck = result.actions.filter((a) => a.outcome === 'left-untouched');

  const out: string[] = [];
  if (removed.length > 0) {
    out.push(
      result.dryRun ? 'Would remove (dry run — nothing was changed):' : 'Removed:',
      ...removed.map((a) =>
        line(
          style.green(style.sym.ok),
          a.surface,
          `${shorten(a.location)}${a.note ? ` — ${a.note}` : ''}`,
        ),
      ),
      '',
    );
  }
  if (stuck.length > 0) {
    out.push(
      'Left untouched — needs you:',
      ...stuck.map((a) =>
        line(
          style.red(style.sym.block),
          a.surface,
          `${shorten(a.location)} ${a.note ?? ''}`.trim(),
        ),
      ),
      '',
    );
  }
  if (removed.length === 0 && stuck.length === 0) {
    out.push("Nothing to remove: SlopSquatShield isn't set up here.", '');
  }
  out.push(
    "Not touched on purpose: your project's .slopsquatshield / .slopsquatshieldrc, and the registry cache (add --purge to delete the cache).",
  );
  if (removed.length > 0 && !result.dryRun) {
    out.push('', 'Next: `npm uninstall -g slopsquatshield`, then open a new terminal.');
  }
  if (result.dryRun && removed.length > 0) {
    out.push('', 'Run it again without --dry-run to remove these.');
  }
  out.push(...creditLines(style));
  return out.join('\n');
}
