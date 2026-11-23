// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describeVerdict } from '../rules/describe.js';
import type { Verdict } from '../rules/types.js';
import { type InstallCheckOptions, checkInstallCommand } from '../scan/check-install-command.js';
import type { UnreachableEntry } from '../scan/scan-dependencies.js';
import { describeUnreachable } from '../scan/unreachable-cause.js';

export interface HookCheckInput {
  toolName: string;
  command: string;
}

/** Host-neutral decision (FR-12.5) — each adapter maps this to its own vocabulary. */
export type HookDecision = 'allow' | 'deny' | 'ask';

export interface HookCheckResult {
  decision: HookDecision;
  /**
   * The full explanation, written for the agent that has to act on it: what was flagged and why,
   * one package per line, and what to do instead. Never suggests a way around the check.
   */
  reason: string;
  /** One short line for the person (Cursor's `user_message`); absent means use `reason`. */
  summary?: string;
  verdicts: Verdict[];
  unreachable: UnreachableEntry[];
  /** Manifests that were read for a manifest-driven install (`npm install`, `npm ci`, …). */
  manifestsChecked?: string[];
}

/** A few words for the person: why each flagged package was flagged. */
function shortLabel(verdict: Verdict): string {
  const first = verdict.signals[0]?.type;
  if (verdict.tier === 'BLOCK' && first === 'non-existence') return 'does not exist';
  if (first === 'private-registry-mismatch') return 'dependency confusion';
  return 'looks risky';
}

const packages = (n: number): string => (n === 1 ? '1 package' : `${n} packages`);

/**
 * What a deny or ask tells the agent. It is the agent that reads this first and decides what to do
 * next, so it says plainly what to do — fix a typo, or stop and ask the user — and never mentions
 * `slopsquatshield allow` or any other way around the check: an agent could run that itself.
 */
function flaggedReason(flagged: Verdict[], decision: 'deny' | 'ask'): string {
  const lines = flagged.map((v) => `- ${describeVerdict(v)}`);
  const n = packages(flagged.length);
  const looks = flagged.length === 1 ? 'looks' : 'look';
  if (decision === 'deny') {
    return [
      `SlopSquatShield blocked this command: ${n} ${looks} hallucinated or risky.`,
      ...lines,
      flagged.length === 1
        ? 'Do not install it. If it is a typo of a real package, use the correct name; otherwise tell the user what was blocked and ask how to proceed. Do not try to get around this check.'
        : 'Do not install these. If one is a typo of a real package, use the correct name; otherwise tell the user what was blocked and ask how to proceed. Do not try to get around this check.',
    ].join('\n');
  }
  return [
    `SlopSquatShield: ${n} in this command ${looks} risky, so it needs the user's confirmation.`,
    ...lines,
    'Do not go ahead on your own judgement: let the user decide.',
  ].join('\n');
}

function flaggedSummary(flagged: Verdict[], decision: 'deny' | 'ask'): string {
  const names = flagged.map((v) => `${v.identifier} (${shortLabel(v)})`).join(', ');
  return decision === 'deny'
    ? `SlopSquatShield blocked this install: ${names}.`
    : `SlopSquatShield: confirm this install? ${names}.`;
}

/**
 * The shared hook contract (FR-12.4): every agent-hook adapter
 * (`hooks/claude-code.ts`, `hooks/cursor.ts`, `hooks/codex.ts` and `hooks/antigravity.ts`)
 * calls this one function and differs only in how it formats the result for its own host's
 * stdout schema — one code path answers every host.
 *
 * Delegates to `checkInstallCommand`, which verifies both the packages a command **names** and,
 * for a manifest-driven install (`npm install`, `npm ci`, `pip install -r f`, …), the packages the
 * project's manifest lists — the case an agent hits when it edits `package.json` with its file
 * tool and then runs a bare `npm install`. A command that isn't an install short-circuits to
 * `allow` with zero registry calls and zero file reads, identical to FR-9.4's passthrough.
 *
 * Decision mapping: any BLOCK verdict → `deny`; else any WARN → `ask`; else → `allow`. A result
 * where part of the install could not be checked (a registry never answered, a manifest could
 * not be parsed, the time budget ran out) is also `allow` — NFR-3.1's fail-open rule means an
 * infrastructure gap is never itself a reason to block or even ask a human to confirm — but the
 * reason says "not verified" rather than claiming "no findings".
 */
export async function runHookCheck(
  input: HookCheckInput,
  options: InstallCheckOptions = {},
): Promise<HookCheckResult> {
  const check = await checkInstallCommand(input.command, options);
  const { verdicts, unreachable, manifestsChecked } = check;
  const extra = manifestsChecked.length > 0 ? { manifestsChecked } : {};

  if (!check.recognized) {
    return {
      decision: 'allow',
      reason: 'not a recognized install command',
      verdicts: [],
      unreachable: [],
    };
  }

  const flagged = [
    ...verdicts.filter((v) => v.tier === 'BLOCK'),
    ...verdicts.filter((v) => v.tier === 'WARN'),
  ];
  if (verdicts.some((v) => v.tier === 'BLOCK')) {
    return {
      decision: 'deny',
      reason: flaggedReason(flagged, 'deny'),
      summary: flaggedSummary(flagged, 'deny'),
      verdicts,
      unreachable,
      ...extra,
    };
  }
  if (verdicts.some((v) => v.tier === 'WARN')) {
    return {
      decision: 'ask',
      reason: flaggedReason(flagged, 'ask'),
      summary: flaggedSummary(flagged, 'ask'),
      verdicts,
      unreachable,
      ...extra,
    };
  }

  const gaps: string[] = [];
  if (unreachable.length > 0) {
    const names = unreachable
      .map((u) => `${u.identifier} (${describeUnreachable(u.error)})`)
      .join(', ');
    gaps.push(`could not reach the registry for ${names}`);
  }
  gaps.push(...check.notVerified);
  if (gaps.length > 0) {
    // Fail open (NFR-3.1), but say so: "no findings" would claim a check that never happened.
    return {
      decision: 'allow',
      reason: `SlopSquatShield allowed \`${input.command}\` but could not verify all of it (fail-open): ${gaps.join('; ')}.`,
      verdicts,
      unreachable,
      ...extra,
    };
  }

  // Say so when the allowlist is the reason nothing was flagged: "no findings" would claim a
  // check that never ran (the same honesty rule as the branch above).
  const allowlisted = verdicts.filter((v) => v.suppressedBy === 'allowlist');
  const checked = manifestsChecked.length > 0 ? ` (checked ${manifestsChecked.join(', ')})` : '';
  const reason =
    allowlisted.length > 0
      ? `SlopSquatShield allowed \`${input.command}\`: ${allowlisted.map((v) => v.identifier).join(', ')} allowlisted in .slopsquatshield, so not checked${checked}.`
      : `SlopSquatShield found nothing wrong with \`${input.command}\`${checked}.`;
  return { decision: 'allow', reason, verdicts, unreachable, ...extra };
}
