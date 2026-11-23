// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { type Verdict, describeUnreachable } from '@slopsquatshield/core';
import type { ScanReport } from '../commands/scan.js';
import { type FindingRow, count, renderFindings, wrap } from './finding.js';
import { type DisplayPathContext, displayPath } from './paths.js';
import { type Style, createStyle, creditLines } from './style.js';

export interface ScanFormatOptions {
  reportOnly?: boolean;
  /** End with the credit (on a terminal). A caller that adds its own closing lines passes false. */
  credit?: boolean;
  /** End with what to do next. Pre-commit passes false: it prints its own numbered steps. */
  next?: boolean;
  style?: Style;
  /** How to show manifest paths. Without it, paths are shown as the scan found them. */
  paths?: DisplayPathContext;
}

/**
 * `package.json [dependencies]` with its path made readable. A source can list several
 * (`a/package.json [dependencies], a/package.json [devDependencies]`); each path is shortened.
 */
function showSources(sources: readonly string[], paths?: DisplayPathContext): string {
  if (!paths) return sources.join(', ');
  return sources
    .flatMap((s) => s.split(', '))
    .map((part) => {
      const at = part.indexOf(' [');
      const path = at === -1 ? part : part.slice(0, at);
      return displayPath(path, paths) + (at === -1 ? '' : part.slice(at));
    })
    .join(', ');
}

/**
 * FR-8.1: the human-readable scan report — a list of findings (BLOCK, then WARN, then packages that
 * could not be checked), any manifests that could not be read, a one-line summary, and what to do
 * next. CLEAN packages aren't listed. `--json` (`json.ts`) carries the same facts for scripts.
 */
export function formatScanReport(report: ScanReport, options: ScanFormatOptions = {}): string {
  const style = options.style ?? createStyle(process.stdout);
  const sourcesOf = (ecosystem: string, identifier: string) =>
    showSources(report.sourcesByKey.get(`${ecosystem}:${identifier}`) ?? [], options.paths);
  const meta = (ecosystem: string, identifier: string) => {
    const where = sourcesOf(ecosystem, identifier);
    return where ? `${ecosystem} ${style.sym.dot} ${where}` : ecosystem;
  };

  const tier = (t: Verdict['tier']) => report.verdicts.filter((v) => v.tier === t);
  const blocked = tier('BLOCK');
  const warned = tier('WARN');
  const rows: FindingRow[] = [
    ...[...blocked, ...warned].map((v) => ({
      kind: v.tier === 'BLOCK' ? ('block' as const) : ('warn' as const),
      name: v.identifier,
      meta: meta(v.ecosystem, v.identifier),
      detail: v.reason,
    })),
    ...report.unreachable.map((u) => ({
      kind: 'unverified' as const,
      name: u.identifier,
      meta: meta(u.ecosystem, u.identifier),
      detail: `Not verified: ${describeUnreachable(u.error)}.`,
    })),
  ];

  const lines: string[] = [];
  if (rows.length > 0) lines.push(...renderFindings(rows, style), '');

  if (report.manifestErrors.length > 0) {
    lines.push(
      style.yellow(
        `Could not read ${count(report.manifestErrors.length, 'manifest')}, so ${
          report.manifestErrors.length === 1 ? 'it was' : 'they were'
        } not checked:`,
      ),
    );
    for (const err of report.manifestErrors) {
      const file = options.paths ? displayPath(err.file, options.paths) : err.file;
      lines.push(...wrap(`${file}:${err.line}:${err.column}: ${err.reason}`, style.width, '  '));
    }
    lines.push('');
  }

  const parts = [
    blocked.length > 0 ? `${blocked.length} blocked` : '',
    warned.length > 0 ? count(warned.length, 'warning') : '',
    report.unreachable.length > 0 ? `${report.unreachable.length} not verified` : '',
    report.manifestErrors.length > 0
      ? `${count(report.manifestErrors.length, 'manifest')} skipped`
      : '',
  ].filter(Boolean);
  const checked = `${count(report.scannedCount, 'package')} checked`;
  lines.push(
    parts.length > 0
      ? `${checked}: ${parts.join(', ')}.`
      : `${style.green(style.sym.ok)} ${checked}: no findings.`,
  );

  if (options.next ?? true) {
    if (blocked.length + warned.length > 0) {
      lines.push(
        ...wrap(
          'Next: fix or remove the package, or run `slopsquatshield allow <name>` if you are sure it is real.',
          style.width,
        ),
      );
    }
    if (report.unreachable.length > 0) {
      lines.push(
        ...wrap(
          'Not verified is not a finding: re-run when the registry is reachable.',
          style.width,
        ),
      );
    }
  }

  if (options.reportOnly) {
    lines.push(
      style.dim(`Report-only: exiting 0 (a normal scan would have exited ${report.exitCode}).`),
    );
  }
  if (options.credit ?? true) lines.push(...creditLines(style));
  return lines.join('\n');
}
