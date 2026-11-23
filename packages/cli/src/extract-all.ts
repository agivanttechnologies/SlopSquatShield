// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import {
  type ExtractedDependency,
  ManifestParseError,
  type PomInput,
  assertWellFormedPom,
  excludeLocalPackages,
  extractDependenciesFromManifest,
  extractMavenDeps,
  packageJsonName,
} from '@slopsquatshield/core';
import type { DiscoveredManifests } from './discover-manifests.js';

export interface ExtractionResult {
  deps: ExtractedDependency[];
  /** Manifests that couldn't be parsed — reported with `file:line:column`, never a stack trace. */
  errors: ManifestParseError[];
}

/**
 * Reads and runs every extractor across the manifests `discoverManifests()` found. A manifest
 * that can't be parsed (NFR-3.3) is recorded in `errors` and skipped — the rest still scan — and
 * an unreadable file (permissions, deleted mid-scan) is reported the same way.
 *
 * Packages that are local to the project — a workspace member named by another package.json, or a
 * `file:`/`link:`/`workspace:`/git/URL specifier — are dropped: they are not on the registry, so
 * checking them would only produce a false "does not exist".
 */
export function extractAllDependencies(manifests: DiscoveredManifests): ExtractionResult {
  const deps: ExtractedDependency[] = [];
  const errors: ManifestParseError[] = [];
  const localNames = new Set<string>();

  const guarded = (path: string, work: () => void): void => {
    try {
      work();
    } catch (err) {
      if (err instanceof ManifestParseError) errors.push(err);
      else
        errors.push(new ManifestParseError(path, 1, 1, `could not read file: ${errMessage(err)}`));
    }
  };

  // Per-file dispatch lives in core (`extractDependenciesFromManifest`) so the editor extension
  // shares it. POMs are the exception: every POM in a project goes to `extractMavenDeps`
  // together so parent/child resolution still works.
  for (const path of [
    ...manifests.packageJson,
    ...manifests.requirementsTxt,
    ...manifests.pyprojectToml,
    ...manifests.pipfile,
  ]) {
    guarded(path, () => {
      const content = readFileSync(path, 'utf-8');
      deps.push(...extractDependenciesFromManifest(path, content));
      if (manifests.packageJson.includes(path)) {
        const name = packageJsonName(content);
        if (name) localNames.add(name);
      }
    });
  }

  const poms: PomInput[] = [];
  for (const path of manifests.pomXml) {
    guarded(path, () => {
      const content = readFileSync(path, 'utf-8');
      assertWellFormedPom(path, content);
      poms.push({ path, content });
    });
  }
  if (poms.length > 0) deps.push(...extractMavenDeps(poms));

  return { deps: excludeLocalPackages(deps, localNames), errors };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface DedupedDependency {
  identifier: string;
  ecosystem: ExtractedDependency['ecosystem'];
  sources: string[];
}

/** Collapses repeated (ecosystem, name) pairs across manifests into one entry per package. */
export function dedupeDependencies(deps: ExtractedDependency[]): DedupedDependency[] {
  const byKey = new Map<string, DedupedDependency>();
  for (const dep of deps) {
    const key = `${dep.ecosystem}:${dep.name}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.sources.includes(dep.source)) existing.sources.push(dep.source);
    } else {
      byKey.set(key, { identifier: dep.name, ecosystem: dep.ecosystem, sources: [dep.source] });
    }
  }
  return [...byKey.values()];
}
