// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { isAbsolute, sep } from 'node:path';
import type { DoctorCheck, DoctorReport } from '../commands/doctor.js';
import { count } from './finding.js';
import type { DisplayPathContext } from './paths.js';
import { type Style, createStyle, creditLines } from './style.js';

type Group = 'Setup' | 'Agent hooks' | 'Toolchain';
const GROUPS: Group[] = ['Setup', 'Agent hooks', 'Toolchain'];

function groupOf(check: DoctorCheck): Group {
  if (/toolchain/i.test(check.surface)) return 'Toolchain';
  if (/hook/i.test(check.surface) && !/git/i.test(check.surface)) return 'Agent hooks';
  return 'Setup';
}

/**
 * The checks' details are written with full paths; show them the way the rest of the CLI does —
 * relative inside the current directory, `~` under home.
 */
function shortenPaths(text: string, paths?: DisplayPathContext): string {
  if (!paths) return text;
  let out = text;
  if (isAbsolute(paths.cwd) && paths.cwd !== paths.home)
    out = out.split(`${paths.cwd}${sep}`).join('');
  if (paths.home) out = out.split(paths.home).join('~');
  return out;
}

/**
 * `doctor`'s report: one line per check under Setup / Agent hooks / Toolchain, each problem with
 * the exact command (or step) that fixes it, then a one-line verdict. Same marks as `init`.
 */
export function formatDoctorReport(
  report: DoctorReport,
  options: { style?: Style; paths?: DisplayPathContext } = {},
): string {
  const style = options.style ?? createStyle(process.stdout);
  const mark = (check: DoctorCheck): string =>
    check.status === 'ok'
      ? style.green(style.sym.ok)
      : check.status === 'outdated'
        ? style.yellow(style.sym.warn)
        : style.red(style.sym.block);
  const column = Math.max(0, ...report.checks.map((c) => c.surface.length));

  const out: string[] = [];
  for (const group of GROUPS) {
    const checks = report.checks.filter((c) => groupOf(c) === group);
    if (checks.length === 0) continue;
    if (out.length > 0) out.push('');
    out.push(style.bold(group));
    for (const check of checks) {
      out.push(
        `  ${mark(check)} ${check.surface.padEnd(column)}  ${shortenPaths(check.detail, options.paths)}`,
      );
      if (check.fixCommand) out.push(`      ${style.dim('fix:')} ${check.fixCommand}`);
    }
  }

  const problems = report.checks.filter((c) => c.status !== 'ok').length;
  out.push(
    '',
    problems === 0
      ? `${style.green(style.sym.ok)} All good.`
      : `${count(problems, 'problem')}: run the fix ${problems === 1 ? 'line' : 'lines'} above.`,
  );
  out.push(...creditLines(style));
  return out.join('\n');
}
