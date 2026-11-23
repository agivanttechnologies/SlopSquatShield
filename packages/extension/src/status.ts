// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { CREDIT, type ExitCode } from '@slopsquatshield/core';
import type { Finding } from './findings.js';
import { exitCodeFor } from './severity.js';

export interface StatusSummary {
  text: string;
  tooltip: string;
  /** The §6 four-code scheme for the whole workspace (FR-19.3). */
  exitCode: ExitCode;
}

const ICONS = { clean: '$(shield)', warn: '$(warning)', block: '$(error)', unreachable: '$(info)' };

/**
 * FR-19.3: the aggregate verdict for every manifest in the workspace, in the shared four-code
 * scheme — 0 clean, 1 suspicious (WARN), 2 hallucination (BLOCK), 3 registry unreachable. It
 * is advisory: the extension never claims to be the enforcement boundary (§5A).
 */
export function summarize(findings: readonly Finding[], scanning = false): StatusSummary {
  const count = (kind: Finding['kind']) => findings.filter((f) => f.kind === kind).length;
  const blocked = count('block');
  const warned = count('warn');
  const unverified = count('unreachable');
  const exitCode = exitCodeFor(findings.map((f) => f.kind));

  // Same words as the CLI. No exit code here: it means something in a terminal, not in an editor.
  const warnings = `${warned} ${warned === 1 ? 'warning' : 'warnings'}`;
  const lines = [
    `${blocked} blocked (hallucination)`,
    warnings,
    `${unverified} not verified (registry unreachable — not a finding)`,
    'Advisory only — install-time enforcement is the CLI wrapper and agent hooks.',
    CREDIT,
  ];

  let text: string;
  if (scanning) text = '$(sync~spin) SlopSquatShield: scanning…';
  else if (blocked > 0) text = `${ICONS.block} SlopSquatShield: ${blocked} blocked`;
  else if (warned > 0) text = `${ICONS.warn} SlopSquatShield: ${warnings}`;
  else if (unverified > 0)
    text = `${ICONS.unreachable} SlopSquatShield: ${unverified} not verified`;
  else text = `${ICONS.clean} SlopSquatShield: clean`;

  return { text, tooltip: lines.join('\n'), exitCode };
}
