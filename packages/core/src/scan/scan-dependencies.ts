// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import pLimit from 'p-limit';
import type { Ecosystem } from '../extractors/types.js';
import type { Verdict } from '../rules/types.js';
import { type ExitCode, computeExitCode } from './exit-codes.js';
import {
  type ResolveVerdictOptions,
  type ResolveVerdictResult,
  resolveVerdict,
} from './resolve-verdict.js';

export interface ScanTarget {
  identifier: string;
  ecosystem: Ecosystem;
}

export interface UnreachableEntry {
  identifier: string;
  ecosystem: Ecosystem;
  error: string;
}

export interface ScanResult {
  /** Every verdict, including CLEAN ones — a caller can filter for WARN/BLOCK to report findings. */
  verdicts: Verdict[];
  unreachable: UnreachableEntry[];
  exitCode: ExitCode;
}

/** Runs a task when a slot is free; see {@link createScanLimit}. */
export type ScanLimit = <T>(task: () => Promise<T>) => Promise<T>;

/** Default number of packages checked at once (each is about three registry requests). */
export const DEFAULT_SCAN_CONCURRENCY = 8;

/**
 * A limit that several `scanDependencies` calls can share, so a caller scanning many manifests
 * at once (the editor extension opening a workspace) stays at one bound in total instead of one
 * bound per manifest. The registries publish no rate limits; they answer 429 to bursts.
 */
export function createScanLimit(concurrency: number = DEFAULT_SCAN_CONCURRENCY): ScanLimit {
  const limit = pLimit(concurrency);
  return (task) => limit(task);
}

export interface ScanDependenciesOptions extends ResolveVerdictOptions {
  /** Bounds concurrent registry calls (FR-3's bounded-concurrency requirement); default 8. */
  concurrency?: number;
  /** A limit shared with other scans; when given, `concurrency` is ignored. */
  limit?: ScanLimit;
  popularPackagesByEcosystem?: Partial<Record<Ecosystem, readonly string[]>>;
  /**
   * Epoch milliseconds after which a target that has not started is reported `unreachable`
   * ("not checked: time budget exceeded") instead of being fetched. Lets an interactive caller —
   * an agent hook — bound a cold-cache check of a large manifest; the answer is then "not
   * verified" (fail open), never a stall. Targets already in flight are allowed to finish.
   */
  deadline?: number;
}

/**
 * Resolves a verdict for every target with bounded concurrency, then translates the
 * results to the shared exit-code scheme (FR-15) in one place — every surface reuses this
 * rather than each computing its own severity/exit-code logic.
 */
export async function scanDependencies(
  targets: ScanTarget[],
  options: ScanDependenciesOptions = {},
): Promise<ScanResult> {
  const limit = options.limit ?? createScanLimit(options.concurrency ?? DEFAULT_SCAN_CONCURRENCY);

  const results = await Promise.all(
    targets.map((target) =>
      limit(async (): Promise<ResolveVerdictResult> => {
        if (options.deadline !== undefined && Date.now() > options.deadline) {
          return {
            kind: 'unreachable',
            identifier: target.identifier,
            ecosystem: target.ecosystem,
            error: 'not checked: time budget exceeded',
          };
        }
        return resolveVerdict(target.identifier, target.ecosystem, {
          ...options,
          popularPackages: options.popularPackagesByEcosystem?.[target.ecosystem],
        });
      }),
    ),
  );

  const verdicts: Verdict[] = [];
  const unreachable: UnreachableEntry[] = [];
  for (const result of results) {
    if (result.kind === 'unreachable') {
      unreachable.push({
        identifier: result.identifier,
        ecosystem: result.ecosystem,
        error: result.error,
      });
    } else {
      verdicts.push(result.verdict);
    }
  }

  return {
    verdicts,
    unreachable,
    exitCode: computeExitCode({ verdicts, unreachableCount: unreachable.length }),
  };
}
