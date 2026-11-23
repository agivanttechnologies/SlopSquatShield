// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import {
  type LockfileIndex,
  type LockfilePin,
  buildLockfileIndex,
  getMavenDependencyTreePins,
  parseNpmLockfile,
  parsePipfileLock,
  parsePoetryLock,
} from '@slopsquatshield/core';
import type { DiscoveredManifests } from './discover-manifests.js';

export interface ScanLockfileOptions {
  /**
   * Run `mvn dependency:tree` at `rootDir` for Maven pins. Off unless the user asks for it
   * (`scan --maven-tree`): Maven runs code the project controls (`.mvn/jvm.config`, POM build
   * extensions and plugins), so doing it by default would let a scanned repository run code.
   */
  mavenTree?: boolean;
}

/**
 * Parses every lockfile `discoverManifests()` found into one combined index (FR-3.4),
 * so `resolveVerdict()` can fast-path any pinned name with zero network calls. Maven has
 * no lockfile of its own; with `mavenTree` set, `mvn dependency:tree` is attempted once (at
 * `rootDir`) when at least one `pom.xml` was found — it fails open to `[]` when Maven isn't
 * on PATH. Without it, Maven dependencies are checked against Maven Central only.
 */
export async function buildScanLockfileIndex(
  rootDir: string,
  manifests: DiscoveredManifests,
  options: ScanLockfileOptions = {},
): Promise<LockfileIndex> {
  const pins: LockfilePin[] = [];

  for (const path of manifests.packageLockJson) {
    pins.push(...parseNpmLockfile(readFileSync(path, 'utf-8')));
  }
  for (const path of manifests.poetryLock) {
    pins.push(...parsePoetryLock(readFileSync(path, 'utf-8')));
  }
  for (const path of manifests.pipfileLock) {
    pins.push(...parsePipfileLock(readFileSync(path, 'utf-8')));
  }
  if (options.mavenTree && manifests.pomXml.length > 0) {
    pins.push(...(await getMavenDependencyTreePins(rootDir)));
  }

  return buildLockfileIndex(pins);
}
