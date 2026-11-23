// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type PomInput, extractMavenDeps } from '../../src/extractors/maven.js';

function readFixture(relPath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../fixtures/maven/${relPath}`, import.meta.url)),
    'utf-8',
  );
}

const poms: PomInput[] = [
  { path: 'parent/pom.xml', content: readFixture('parent/pom.xml') },
  { path: 'child-a/pom.xml', content: readFixture('child-a/pom.xml') },
  { path: 'child-b/pom.xml', content: readFixture('child-b/pom.xml') },
];

describe('extractMavenDeps', () => {
  it('extracts all 15 declared dependencies across both children', () => {
    const deps = extractMavenDeps(poms);
    expect(deps).toHaveLength(15);
  });

  it('resolves the 3 version-omitted deps from parent dependencyManagement', () => {
    const deps = extractMavenDeps(poms);
    const inherited = [
      ['org.springframework:spring-core', '5.3.31'],
      ['com.fasterxml.jackson.core:jackson-databind', '2.15.2'],
      ['org.apache.commons:commons-lang3', '3.14.0'],
    ];
    for (const [name, version] of inherited) {
      const dep = deps.find((d) => d.name === name);
      expect(dep?.specifier).toBe(version);
    }
  });

  it('leaves explicitly-versioned dependencies untouched', () => {
    const deps = extractMavenDeps(poms);
    const junit = deps.find((d) => d.name === 'junit:junit');
    expect(junit?.specifier).toBe('4.13.2');
  });

  it('emits groupId:artifactId as the name and tags the maven ecosystem', () => {
    const deps = extractMavenDeps(poms);
    expect(deps.every((d) => /^[^:]+:[^:]+$/.test(d.name))).toBe(true);
    expect(deps.every((d) => d.ecosystem === 'maven')).toBe(true);
  });
});
