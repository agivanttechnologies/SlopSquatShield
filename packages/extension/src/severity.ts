// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { EXIT_CODES, type ExitCode } from '@slopsquatshield/core';

export type Severity = 'error' | 'warning' | 'information';

/** What a finding is, before it is mapped onto an editor severity. */
export type FindingKind = 'block' | 'warn' | 'unreachable' | 'parse-error';

/**
 * FR-19.4: BLOCK → Error, WARN → Warning, registry-unreachable → Information — *never* Error,
 * because NFR-3.1's fail-open applies to the editor too. A manifest that can't be parsed is
 * likewise only Information: it's the user's file to fix, not a finding about a package.
 */
export function severityFor(kind: FindingKind): Severity {
  switch (kind) {
    case 'block':
      return 'error';
    case 'warn':
      return 'warning';
    case 'unreachable':
    case 'parse-error':
      return 'information';
  }
}

/**
 * The §6 four-code scheme for a set of findings, same precedence as core's `scanDependencies`:
 * BLOCK (2) beats WARN (1) beats "could not check" (3) beats clean (0), where "could not check" is an
 * unreachable registry or a manifest that could not be parsed — the same as the CLI's `scan`.
 */
export function exitCodeFor(kinds: readonly FindingKind[]): ExitCode {
  if (kinds.includes('block')) return EXIT_CODES.HALLUCINATION;
  if (kinds.includes('warn')) return EXIT_CODES.SUSPICIOUS;
  if (kinds.includes('unreachable') || kinds.includes('parse-error')) return EXIT_CODES.UNREACHABLE;
  return EXIT_CODES.CLEAN;
}
