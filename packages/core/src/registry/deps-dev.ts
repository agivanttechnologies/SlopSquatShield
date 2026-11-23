// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { proxyFetch } from './proxy-fetch.js';

export type DepsDevSystem = 'npm' | 'pypi' | 'maven';

const SYSTEM_NAME: Record<DepsDevSystem, string> = { npm: 'NPM', pypi: 'PYPI', maven: 'MAVEN' };

const DEPS_DEV_BASE_URL = 'https://api.deps.dev/v3';

export interface DepsDevFacts {
  exists: boolean;
  /** ISO timestamp of the package's earliest known version publish. */
  firstPublishedAt?: string;
  /** Derived from the default version's SOURCE_REPO related project, if declared. */
  repoUrl?: string;
}

interface DepsDevPackageVersion {
  versionKey?: { version?: string };
  publishedAt?: string;
  isDefault?: boolean;
}

interface DepsDevPackageResponse {
  versions?: DepsDevPackageVersion[];
}

interface DepsDevRelatedProject {
  projectKey?: { id?: string };
  relationType?: string;
}

interface DepsDevVersionResponse {
  relatedProjects?: DepsDevRelatedProject[];
}

function projectIdToUrl(id: string): string {
  return `https://${id}`;
}

function earliestPublishedAt(versions: DepsDevPackageVersion[]): string | undefined {
  const dates = versions.map((v) => v.publishedAt).filter((d): d is string => Boolean(d));
  if (dates.length === 0) return undefined;
  return [...dates].sort()[0];
}

/**
 * Queries deps.dev for a package's existence, first-publish date, and declared
 * source-repo link (FR-3.1). deps.dev's public API (verified against its `api.proto`)
 * exposes no download/popularity metric at all — that signal comes only from the
 * native-registry fallback (FR-3.2), never from this client.
 *
 * A 404 on GetPackage means the name doesn't exist on this registry — a real finding,
 * returned as `{ exists: false }`. Any other failure (network error, 5xx, malformed
 * body) throws rather than being folded into `exists: false`, so callers can apply
 * NFR-3.1's fail-open rule (registry unreachable is never itself a security finding)
 * instead of this client silently turning "unreachable" into "doesn't exist".
 */
export async function getDepsDevFacts(
  system: DepsDevSystem,
  name: string,
  fetchImpl: typeof fetch = proxyFetch,
): Promise<DepsDevFacts> {
  const encodedName = encodeURIComponent(name);
  const packageUrl = `${DEPS_DEV_BASE_URL}/systems/${SYSTEM_NAME[system]}/packages/${encodedName}`;

  const packageRes = await fetchImpl(packageUrl);
  if (packageRes.status === 404) return { exists: false };
  if (!packageRes.ok) {
    throw new Error(`deps.dev GetPackage failed for ${system}:${name} (HTTP ${packageRes.status})`);
  }

  const pkg = (await packageRes.json()) as DepsDevPackageResponse;
  const versions = pkg.versions ?? [];
  const firstPublishedAt = earliestPublishedAt(versions);

  const defaultVersion = versions.find((v) => v.isDefault) ?? versions[0];
  const repoUrl = defaultVersion?.versionKey?.version
    ? await getRepoUrl(fetchImpl, packageUrl, defaultVersion.versionKey.version)
    : undefined;

  return { exists: true, firstPublishedAt, repoUrl };
}

async function getRepoUrl(
  fetchImpl: typeof fetch,
  packageUrl: string,
  version: string,
): Promise<string | undefined> {
  const versionUrl = `${packageUrl}/versions/${encodeURIComponent(version)}`;
  const versionRes = await fetchImpl(versionUrl);
  if (!versionRes.ok) return undefined;

  const versionDoc = (await versionRes.json()) as DepsDevVersionResponse;
  const sourceRepo = versionDoc.relatedProjects?.find((p) => p.relationType === 'SOURCE_REPO');
  return sourceRepo?.projectKey?.id ? projectIdToUrl(sourceRepo.projectKey.id) : undefined;
}
