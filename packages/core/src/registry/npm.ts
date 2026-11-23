// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import npmRegistryFetch from 'npm-registry-fetch';
import { proxyFetch } from './proxy-fetch.js';
import { getUserAgent } from './user-agent.js';

export interface NpmRegistryFacts {
  exists: boolean;
  firstPublishedAt?: string;
  repoUrl?: string;
  /** Weekly download count — the popularity signal deps.dev's API has no field for at all. */
  weeklyDownloads?: number;
}

interface NpmPackumentResponse {
  time?: { created?: string };
  repository?: { url?: string } | string;
}

interface NpmDownloadsResponse {
  downloads?: number;
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    (err as { statusCode?: unknown }).statusCode === 404
  );
}

function normalizeRepoUrl(repository: NpmPackumentResponse['repository']): string | undefined {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (!raw) return undefined;
  return raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

/**
 * Weekly downloads alone — one request, never throws (`undefined` on any failure). Exported so a
 * caller that already knows the package exists can refresh just this figure instead of
 * re-fetching the whole packument (see `fetchFacts` in `scan/resolve-verdict.ts`).
 */
export async function getNpmWeeklyDownloads(
  name: string,
  fetchImpl: typeof fetch = proxyFetch,
): Promise<number | undefined> {
  try {
    const res = await fetchImpl(
      `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as NpmDownloadsResponse;
    return body.downloads;
  } catch {
    return undefined;
  }
}

/** Retry policy for the packument fallback (make-fetch-happen's `retry` option). */
export const NPM_RETRY = { retries: 1, factor: 1, minTimeout: 1000, maxTimeout: 2000 } as const;
export const NPM_TIMEOUT_MS = 30_000;

/**
 * npm native-registry fallback (FR-3.2): existence, first-publish date, repo link, and
 * weekly downloads. Used both when deps.dev is unreachable and as the sole source of the
 * popularity signal, which deps.dev never provides (FR-3.1). Uses `npm-registry-fetch`, which
 * honours the HTTP(S)_PROXY environment variables itself. It does **not** read `.npmrc`: npm's own
 * CLI passes it that config, and we pass none, so the lookup always goes to the public
 * registry.npmjs.org with no credentials (see `proxy-fetch.ts` for the other clients).
 *
 * A 404 on the packument means the name doesn't exist — returned as `{ exists: false }`.
 * Any other failure throws (NFR-3.1: registry-unreachable stays distinct from
 * non-existence). A failure fetching download counts alone does not abort resolution —
 * it's a soft-omitted signal, same treatment as Maven's structural downloads gap (FR-4).
 */
export async function getNpmRegistryFacts(
  name: string,
  fetchImpl: typeof fetch = proxyFetch,
): Promise<NpmRegistryFacts> {
  let packument: NpmPackumentResponse;
  try {
    packument = (await npmRegistryFetch.json(name, {
      userAgent: getUserAgent(),
      // Left unset, a 429 or 5xx is retried with growing waits and a request may hang for up to
      // 5 minutes: far too long inside an agent hook. One short retry, then "couldn't check".
      retry: NPM_RETRY,
      timeout: NPM_TIMEOUT_MS,
    })) as NpmPackumentResponse;
  } catch (err) {
    if (isNotFoundError(err)) return { exists: false };
    throw err;
  }

  const firstPublishedAt = packument.time?.created;
  const repoUrl = normalizeRepoUrl(packument.repository);
  const weeklyDownloads = await getNpmWeeklyDownloads(name, fetchImpl);

  return { exists: true, firstPublishedAt, repoUrl, weeklyDownloads };
}
