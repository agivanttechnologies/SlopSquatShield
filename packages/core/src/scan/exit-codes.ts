// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * FR-15's canonical exit-code scheme. Every surface (CLI, shell wrapper, agent-hook
 * adapters) translates its own outcome to one of these four codes rather than inventing
 * separate severity logic — computed once here, in core, so that translation can never
 * drift between surfaces.
 */
export const EXIT_CODES = {
  CLEAN: 0,
  SUSPICIOUS: 1,
  HALLUCINATION: 2,
  UNREACHABLE: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/**
 * The one place the four-code scheme's precedence lives: BLOCK (2) beats WARN (1) beats "could
 * not check" (3) beats clean (0). "Could not check" is a registry that never answered **or** a
 * manifest that could not be parsed — either way something was not looked at, so the result must
 * never read as a clean bill of health (NFR-3.1) — but neither is itself a finding, so a confirmed
 * BLOCK/WARN elsewhere always wins.
 */
export function computeExitCode(input: {
  verdicts: ReadonlyArray<{ tier: 'BLOCK' | 'WARN' | 'CLEAN' }>;
  unreachableCount: number;
  manifestErrorCount?: number;
}): ExitCode {
  if (input.verdicts.some((v) => v.tier === 'BLOCK')) return EXIT_CODES.HALLUCINATION;
  if (input.verdicts.some((v) => v.tier === 'WARN')) return EXIT_CODES.SUSPICIOUS;
  if (input.unreachableCount > 0 || (input.manifestErrorCount ?? 0) > 0) {
    return EXIT_CODES.UNREACHABLE;
  }
  return EXIT_CODES.CLEAN;
}
