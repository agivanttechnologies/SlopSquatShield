// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
/** The prefix `resolve-verdict.ts` puts on the error of a lockfile-pinned package it couldn't check. */
const PINNED_PREFIX = 'pinned in the lockfile, but its risk signals could not be fetched — ';

const CAUSES: Array<[RegExp, string]> = [
  [/time budget/i, 'ran out of time'],
  [/ECONNREFUSED/, 'connection refused'],
  [/ECONNRESET|socket hang up/i, 'connection reset'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/, 'could not look up the registry (offline?)'],
  [/ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out|timeout/i, 'timed out'],
  [/\b407\b|proxy/i, 'proxy error'],
  [/CERT|certificate|SSL|TLS/i, 'TLS certificate problem'],
  [/ENETUNREACH|EHOSTUNREACH/, 'network unreachable'],
];

/**
 * Why a registry couldn't be reached, in a few words a person can act on — `connection refused`,
 * `timed out`, `HTTP 503` — instead of the raw fetch error (`request to https://… failed, reason:
 * connect ECONNREFUSED 127.0.0.1:9`). For human output only; `--json` keeps the raw error.
 */
export function describeUnreachable(error: string): string {
  const pinned = error.startsWith(PINNED_PREFIX);
  const raw = pinned ? error.slice(PINNED_PREFIX.length) : error;
  let cause = CAUSES.find(([pattern]) => pattern.test(raw))?.[1];
  if (!cause) {
    const status = raw.match(/\b([45]\d\d)\b/)?.[1];
    cause = status ? `HTTP ${status}` : raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
  }
  return pinned ? `pinned in the lockfile; ${cause}` : cause;
}
