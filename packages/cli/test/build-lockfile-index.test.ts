// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredManifests } from '../src/discover-manifests.js';

const getMavenDependencyTreePins = vi.fn(async () => [
  { name: 'org.example:lib', version: '1.0.0' },
]);
vi.mock('@slopsquatshield/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@slopsquatshield/core')>()),
  getMavenDependencyTreePins,
}));

const { buildScanLockfileIndex } = await import('../src/build-lockfile-index.js');

const withPom: DiscoveredManifests = {
  packageJson: [],
  packageLockJson: [],
  requirementsTxt: [],
  pyprojectToml: [],
  pipfile: [],
  poetryLock: [],
  pipfileLock: [],
  pomXml: ['/proj/pom.xml'],
};

describe('buildScanLockfileIndex: Maven runs project-controlled code, so only on request', () => {
  beforeEach(() => getMavenDependencyTreePins.mockClear());

  it('does not run `mvn dependency:tree` by default, even with a pom.xml present', async () => {
    await buildScanLockfileIndex('/proj', withPom);
    expect(getMavenDependencyTreePins).not.toHaveBeenCalled();
  });

  it('runs it with `mavenTree` (scan --maven-tree)', async () => {
    await buildScanLockfileIndex('/proj', withPom, { mavenTree: true });
    expect(getMavenDependencyTreePins).toHaveBeenCalledWith('/proj');
  });
});
