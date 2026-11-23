// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { proxyFetch } from './proxy-fetch.js';

export interface PyPiRegistryFacts {
  exists: boolean;
  firstPublishedAt?: string;
  repoUrl?: string;
  /** Weekly download count — the popularity signal deps.dev's API has no field for at all. */
  weeklyDownloads?: number;
}

interface PyPiJsonResponse {
  info?: { project_urls?: Record<string, string> | null };
  releases?: Record<string, Array<{ upload_time_iso_8601?: string }>>;
}

interface PyPiStatsRecentResponse {
  data?: { last_week?: number };
}

const REPO_URL_KEY_PATTERN = /source|repository|code|github|gitlab/i;

function earliestPublishedAt(releases: PyPiJsonResponse['releases']): string | undefined {
  const dates = Object.values(releases ?? {})
    .flat()
    .map((file) => file.upload_time_iso_8601)
    .filter((d): d is string => Boolean(d));
  if (dates.length === 0) return undefined;
  return [...dates].sort()[0];
}

/**
 * A repo-labeled key (Source/Repository/…) is preferred over a generic Homepage, which
 * often points at project docs rather than the actual repo — Homepage is only used as a
 * last resort when nothing more specific is declared.
 */
function findRepoUrl(projectUrls: Record<string, string> | null | undefined): string | undefined {
  if (!projectUrls) return undefined;
  const specific = Object.entries(projectUrls).find(([key]) => REPO_URL_KEY_PATTERN.test(key));
  if (specific) return specific[1];
  return projectUrls.Homepage ?? projectUrls.homepage;
}

/**
 * Weekly downloads alone (via pypistats.org) — one request, never throws (`undefined` on any
 * failure). Exported for the same reason as `getNpmWeeklyDownloads`.
 */
export async function getPyPiWeeklyDownloads(
  name: string,
  fetchImpl: typeof fetch = proxyFetch,
): Promise<number | undefined> {
  try {
    const res = await fetchImpl(
      `https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`,
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as PyPiStatsRecentResponse;
    return body.data?.last_week;
  } catch {
    return undefined;
  }
}

/**
 * PyPI native-registry fallback (FR-3.2): existence, first-publish date, repo link (via
 * `info.project_urls`), and weekly downloads (via pypistats.org, since PyPI's own JSON API
 * has no download-count field). Same fail-open treatment as `npm.ts`: a 404 on the package
 * JSON endpoint means the name doesn't exist; any other failure throws (NFR-3.1); a failed
 * pypistats lookup alone soft-omits the popularity signal rather than aborting resolution.
 */
export async function getPyPiRegistryFacts(
  name: string,
  fetchImpl: typeof fetch = proxyFetch,
): Promise<PyPiRegistryFacts> {
  const res = await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (res.status === 404) return { exists: false };
  if (!res.ok) {
    throw new Error(`PyPI JSON API failed for ${name} (HTTP ${res.status})`);
  }

  const pkg = (await res.json()) as PyPiJsonResponse;
  const firstPublishedAt = earliestPublishedAt(pkg.releases);
  const repoUrl = findRepoUrl(pkg.info?.project_urls);
  const weeklyDownloads = await getPyPiWeeklyDownloads(name, fetchImpl);

  return { exists: true, firstPublishedAt, repoUrl, weeklyDownloads };
}
