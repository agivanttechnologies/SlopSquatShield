// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { EXIT_CODES } from '@slopsquatshield/core';
import { classifyManifests } from '../discover-manifests.js';
import type { DisplayPathContext } from '../format/paths.js';
import { formatScanReport } from '../format/scan.js';
import { type Style, createStyle, creditLines } from '../format/style.js';
import { runScan } from './scan.js';

/** What a person should do when the hook blocks — FR-20.5's documented override order. */
export const OVERRIDE_ORDER = [
  '1. Fix it — remove or correct the dependency.',
  '2. Allowlist it — `slopsquatshield allow <package>` if you are sure it is legitimate.',
  '3. Last resort — `git commit --no-verify` skips this hook.',
].join('\n');

export interface PrecommitOptions {
  /** Override for the registry cache — mainly for tests. */
  cachePath?: string;
  /** How the output looks; defaults to what stderr (where the hook writes) supports. */
  style?: Style;
  /** How to show paths; defaults to relative to the current directory, `~` for home. */
  paths?: DisplayPathContext;
}

export interface PrecommitResult {
  /** Only `2` (BLOCK) fails the commit; WARN (1) and unreachable (3) are printed and pass (FR-20.3). */
  exitCode: 0 | 2;
  /** What the scan itself would have exited with — kept for the message and for tests. */
  scanExitCode: number;
  output: string;
  scannedCount: number;
}

/** Files staged for the next commit that still exist (added, copied, modified, renamed). */
export function listStagedFiles(
  cwd: string,
  git: (args: string[], cwd: string) => string = (args, dir) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }),
): { root: string; files: string[] } {
  const root = git(['rev-parse', '--show-toplevel'], cwd).trim();
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root)
    .split('\0')
    .filter(Boolean);
  return { root, files: names };
}

/**
 * The advisory pre-commit scan (FR-20, §5A). It looks only at the staged manifests and
 * lockfiles — never the whole tree (FR-20.2) — and reuses `runScan`, so it applies the same
 * allowlist, config, cache and verdicts as every other surface. The exit code is remapped:
 * **only a BLOCK (2) fails the commit**; WARN and an unreachable registry print and pass
 * (FR-20.3, NFR-3.1). It never claims to be enforcement: `--no-verify` is always available.
 */
export async function runPrecommit(
  rootDir: string,
  files: readonly string[],
  options: PrecommitOptions = {},
): Promise<PrecommitResult> {
  const absolute = files.map((f) => resolve(rootDir, f)).filter((f) => existsSync(f));
  const manifests = classifyManifests(absolute);
  const relevant = Object.values(manifests).flat();
  if (relevant.length === 0) {
    return { exitCode: 0, scanExitCode: EXIT_CODES.CLEAN, output: '', scannedCount: 0 };
  }

  const report = await runScan(rootDir, { files: absolute, cachePath: options.cachePath });
  const style = options.style ?? createStyle(process.stderr);
  const paths = options.paths ?? { cwd: process.cwd(), home: homedir() };
  const lines = [formatScanReport(report, { credit: false, next: false, style, paths })];

  if (report.exitCode === EXIT_CODES.HALLUCINATION) {
    lines.push(
      '',
      'SlopSquatShield blocked this commit: a staged dependency looks hallucinated.',
      OVERRIDE_ORDER,
    );
  } else if (report.exitCode === EXIT_CODES.SUSPICIOUS) {
    lines.push('', 'SlopSquatShield: warnings only — the commit is not blocked.');
  } else if (report.exitCode === EXIT_CODES.UNREACHABLE) {
    // Exit 3 means "could not check": a registry that never answered, a manifest that could not be
    // parsed, or both. Neither is a finding, so the commit goes ahead — but say which it was.
    const causes = [
      report.unreachable.length > 0 ? 'a registry was unreachable' : '',
      report.manifestErrors.length > 0 ? 'a staged manifest could not be parsed' : '',
    ].filter(Boolean);
    lines.push(
      '',
      `SlopSquatShield: ${causes.join(' and ')} — not a finding, but not checked; the commit goes ahead.`,
    );
  }
  lines.push(
    '(This hook is advisory; install-time enforcement is the CLI wrapper and agent hooks.)',
    ...creditLines(style),
  );

  return {
    exitCode: report.exitCode === EXIT_CODES.HALLUCINATION ? 2 : 0,
    scanExitCode: report.exitCode,
    output: lines.join('\n'),
    scannedCount: report.scannedCount,
  };
}
