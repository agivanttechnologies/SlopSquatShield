// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { ScanReport } from '../commands/scan.js';

export interface ScanJsonOutput {
  scannedCount: number;
  /** The exit code a normal scan would return — still reported under `--report-only`. */
  exitCode: number;
  /** True under `--report-only`: the process exits 0 regardless of `exitCode` (FR-18). */
  reportOnly: boolean;
  findings: Array<{
    identifier: string;
    ecosystem: string;
    tier: 'WARN' | 'BLOCK';
    reason: string;
    sources: string[];
  }>;
  unreachable: Array<{ identifier: string; ecosystem: string; error: string; sources: string[] }>;
  /** Manifests that couldn't be parsed and were skipped (NFR-3.3). */
  manifestErrors: Array<{ file: string; line: number; column: number; reason: string }>;
}

/** FR-8.2: machine-readable output, same underlying findings as the table. */
export function formatScanJson(report: ScanReport, options: { reportOnly?: boolean } = {}): string {
  const output: ScanJsonOutput = {
    scannedCount: report.scannedCount,
    exitCode: report.exitCode,
    reportOnly: options.reportOnly ?? false,
    findings: report.verdicts
      .filter((v) => v.tier === 'WARN' || v.tier === 'BLOCK')
      .map((v) => ({
        identifier: v.identifier,
        ecosystem: v.ecosystem,
        tier: v.tier as 'WARN' | 'BLOCK',
        reason: v.reason,
        sources: report.sourcesByKey.get(`${v.ecosystem}:${v.identifier}`) ?? [],
      })),
    unreachable: report.unreachable.map((entry) => ({
      identifier: entry.identifier,
      ecosystem: entry.ecosystem,
      error: entry.error,
      sources: report.sourcesByKey.get(`${entry.ecosystem}:${entry.identifier}`) ?? [],
    })),
    manifestErrors: report.manifestErrors.map((e) => ({
      file: e.file,
      line: e.line,
      column: e.column,
      reason: e.reason,
    })),
  };
  return JSON.stringify(output, null, 2);
}
