// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { type UnreachableEntry, type Verdict, describeUnreachable } from '@slopsquatshield/core';
import { type FindingRow, renderFindings, wrap } from './finding.js';
import type { Style } from './style.js';

export interface InstallCheckSummary {
  verdicts: readonly Verdict[];
  unreachable: readonly UnreachableEntry[];
  /** Plain-English parts of the install that were not checked (a manifest that didn't parse, …). */
  notVerified: readonly string[];
}

function rows(verdicts: readonly Verdict[], style: Style): FindingRow[] {
  return verdicts.map((v) => ({
    kind: v.tier === 'BLOCK' ? 'block' : 'warn',
    name: v.identifier,
    meta: `${v.ecosystem} ${style.sym.dot} ${v.declaredIn ? `declared in ${v.declaredIn}` : 'named in the command'}`,
    detail: v.reason,
  }));
}

/**
 * What the install wrapper (`slopsquatshield npm|pip|mvn …`, and the shell wrapper that calls it)
 * writes to stderr before it either refuses or forwards a command. Empty when there is nothing to
 * say — a clean, fully checked install prints nothing at all.
 *
 * It never suggests a way around the wrapper: an AI agent running commands in a wrapped shell reads
 * this too, and should fix the name or ask, not route around the check.
 */
export function formatInstallReport(
  command: string,
  check: InstallCheckSummary,
  style: Style,
): string {
  const lines: string[] = [];
  const blocked = check.verdicts.filter((v) => v.tier === 'BLOCK');
  const warned = check.verdicts.filter((v) => v.tier === 'WARN');

  if (blocked.length > 0) {
    lines.push(
      ...wrap(`slopsquatshield: blocked \`${command}\`; nothing was installed.`, style.width).map(
        (l, i) => (i === 0 ? style.red(l) : l),
      ),
      ...renderFindings(rows([...blocked, ...warned], style), style),
      ...wrap(
        'Next: fix or remove the package, or run `slopsquatshield allow <name>` if you are sure it is real.',
        style.width,
      ),
    );
    return lines.join('\n');
  }

  if (warned.length > 0) {
    lines.push(
      style.yellow(`slopsquatshield: warning for \`${command}\`; installing anyway.`),
      ...renderFindings(rows(warned, style), style),
    );
  }

  // Fail open (NFR-3.1), but say so: a silent passthrough would read as "verified".
  if (check.unreachable.length > 0) {
    const names = check.unreachable
      .map((u) => `${u.identifier} (${describeUnreachable(u.error)})`)
      .join(', ');
    lines.push(
      ...wrap(
        `slopsquatshield: could not reach the registry to verify ${names}; not checked, installing anyway.`,
        style.width,
      ),
    );
  }
  for (const gap of check.notVerified) {
    lines.push(...wrap(`slopsquatshield: ${gap}; not checked, installing anyway.`, style.width));
  }
  return lines.join('\n');
}
