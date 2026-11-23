// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { XMLParser } from 'fast-xml-parser';
import { proxyFetch } from './proxy-fetch.js';

export interface MavenCentralFacts {
  exists: boolean;
  firstPublishedAt?: string;
  repoUrl?: string;
}

interface MavenSolrDoc {
  v?: string;
  timestamp?: number;
}

interface MavenSolrResponse {
  response?: { numFound?: number; docs?: MavenSolrDoc[] };
}

interface PomShape {
  project?: {
    scm?: { url?: string };
    parent?: { groupId?: string; artifactId?: string; version?: string };
  };
}

/** How many `<parent>` links to follow looking for an `<scm>` (real projects are 1–3 deep). */
const MAX_PARENT_DEPTH = 3;

const pomParser = new XMLParser({ ignoreAttributes: true });

function parseCoordinate(coordinate: string): { groupId: string; artifactId: string } {
  const [groupId, artifactId] = coordinate.split(':');
  if (!groupId || !artifactId) {
    throw new Error(`Invalid Maven coordinate "${coordinate}", expected "groupId:artifactId"`);
  }
  return { groupId, artifactId };
}

function pomUrl(groupId: string, artifactId: string, version: string): string {
  return `https://repo1.maven.org/maven2/${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}.pom`;
}

/**
 * The project's `<scm><url>`, following `<parent>` when the artifact's own POM has none. A module
 * of a multi-module build (slf4j-api, guava, logback-classic, …) declares its repository once, in
 * the parent POM, and inherits it — reading only the artifact's own POM made almost every such
 * well-known artifact look like it had no source repository.
 */
async function getRepoUrl(
  fetchImpl: typeof fetch,
  groupId: string,
  artifactId: string,
  version: string,
  depth = 0,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(pomUrl(groupId, artifactId, version));
    if (!res.ok) return undefined;
    const project = (pomParser.parse(await res.text()) as PomShape).project;
    if (project?.scm?.url) return project.scm.url;

    const parent = project?.parent;
    if (depth >= MAX_PARENT_DEPTH || !parent?.groupId || !parent.artifactId || !parent.version) {
      return undefined;
    }
    return getRepoUrl(
      fetchImpl,
      parent.groupId,
      parent.artifactId,
      String(parent.version),
      depth + 1,
    );
  } catch {
    return undefined;
  }
}

/**
 * Maven Central client (FR-3.3) — primary/only source for Maven, not a deps.dev fallback,
 * since deps.dev's Maven coverage was unconfirmed at build time. Existence and first-publish
 * come from the Solr search API (`core=gav`, one doc per version); no `sort` param is relied
 * on since public support for it is undocumented, so all returned docs are scanned
 * client-side for the earliest `timestamp`. Repo link is a best-effort fetch of the latest
 * version's POM `<scm><url>` (following `<parent>` for an inherited one) — its absence never fails resolution (FR-4 treats a missing
 * repo link as a soft WARN signal, not an error).
 *
 * Maven Central has no public download-count API at all, so — unlike npm/PyPI — there is no
 * `weeklyDownloads` field here; FR-4 already documents popularity as a structurally omitted
 * signal for Maven, not one that can fail open per-call.
 */
export async function getMavenCentralFacts(
  coordinate: string,
  fetchImpl: typeof fetch = proxyFetch,
): Promise<MavenCentralFacts> {
  const { groupId, artifactId } = parseCoordinate(coordinate);
  const searchUrl = `https://search.maven.org/solrsearch/select?q=g:%22${encodeURIComponent(
    groupId,
  )}%22+AND+a:%22${encodeURIComponent(artifactId)}%22&core=gav&rows=200&wt=json`;

  const res = await fetchImpl(searchUrl);
  if (!res.ok) {
    throw new Error(`Maven Central search failed for ${coordinate} (HTTP ${res.status})`);
  }

  const body = (await res.json()) as MavenSolrResponse;
  const docs = body.response?.docs ?? [];
  if ((body.response?.numFound ?? docs.length) === 0) return { exists: false };

  const timestamped = docs.filter((d): d is Required<MavenSolrDoc> =>
    Boolean(d.v && d.timestamp !== undefined),
  );
  const earliest = timestamped.reduce<MavenSolrDoc | undefined>(
    (min, d) =>
      min === undefined || (d.timestamp as number) < (min.timestamp as number) ? d : min,
    undefined,
  );
  const latest = timestamped.reduce<MavenSolrDoc | undefined>(
    (max, d) =>
      max === undefined || (d.timestamp as number) > (max.timestamp as number) ? d : max,
    undefined,
  );

  const firstPublishedAt = earliest?.timestamp
    ? new Date(earliest.timestamp).toISOString()
    : undefined;
  const repoUrl = latest?.v
    ? await getRepoUrl(fetchImpl, groupId, artifactId, latest.v)
    : undefined;

  return { exists: true, firstPublishedAt, repoUrl };
}
