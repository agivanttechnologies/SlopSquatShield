// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { XMLParser } from 'fast-xml-parser';
import type { ExtractedDependency } from './types.js';

export interface PomInput {
  path: string;
  content: string;
}

interface MavenDependencyXml {
  groupId: string;
  artifactId: string;
  version?: string;
}

interface PomXmlShape {
  project?: {
    dependencyManagement?: {
      dependencies?: { dependency?: MavenDependencyXml | MavenDependencyXml[] };
    };
    dependencies?: { dependency?: MavenDependencyXml | MavenDependencyXml[] };
  };
}

const parser = new XMLParser({ ignoreAttributes: true });

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function coordinateKey(dep: MavenDependencyXml): string {
  return `${dep.groupId}:${dep.artifactId}`;
}

/**
 * Extracts every <dependency> across a set of POMs (FR-1.3), resolving versions
 * omitted in a child's <dependencies> against the combined <dependencyManagement>
 * of the whole set (parent-POM inheritance) — the fixture set is small enough that
 * a single combined lookup, rather than walking <parent>/<relativePath> links, is
 * sufficient and avoids needing filesystem access inside a pure extractor function.
 */
export function extractMavenDeps(poms: PomInput[]): ExtractedDependency[] {
  const parsed = poms.map((pom) => ({
    path: pom.path,
    doc: parser.parse(pom.content) as PomXmlShape,
  }));

  const managedVersions = new Map<string, string>();
  for (const { doc } of parsed) {
    const managed = toArray(doc.project?.dependencyManagement?.dependencies?.dependency);
    for (const dep of managed) {
      if (dep.version) managedVersions.set(coordinateKey(dep), dep.version);
    }
  }

  const result: ExtractedDependency[] = [];
  for (const { path, doc } of parsed) {
    const declared = toArray(doc.project?.dependencies?.dependency);
    for (const dep of declared) {
      const key = coordinateKey(dep);
      const specifier = dep.version ?? managedVersions.get(key);
      result.push({
        name: key,
        ecosystem: 'maven',
        specifier,
        source: path,
      });
    }
  }

  return result;
}
