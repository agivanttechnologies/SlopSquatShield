// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import {
  EXIT_CODES,
  type ManifestParseError,
  POPULAR_MAVEN_COORDINATES,
  POPULAR_NPM_PACKAGES,
  POPULAR_PYPI_PACKAGES,
  type ScanResult,
  computeExitCode,
  scanDependencies,
} from '@slopsquatshield/core';
import { buildScanLockfileIndex } from '../build-lockfile-index.js';
import { classifyManifests, discoverManifests } from '../discover-manifests.js';
import { dedupeDependencies, extractAllDependencies } from '../extract-all.js';
import { LazyRegistryCache } from '../hooks/lazy-cache.js';
import { loadProjectContext } from '../project-context.js';

export interface RunScanOptions {
  /**
   * Scan only these files (already-resolved paths) instead of walking `rootDir` — what the
   * pre-commit hook passes (FR-20.2). `rootDir` still decides which allowlist/config apply.
   */
  files?: readonly string[];
  /**
   * Run `mvn dependency:tree` in `rootDir` for Maven pins (`scan --maven-tree`). Off by default:
   * Maven runs code the scanned project controls, and `scan` is meant to be safe on a project
   * you have not trusted yet. Ignored for a file-list scan.
   */
  mavenTree?: boolean;
  /** Override for `RegistryCache`'s DB path — mainly for tests; defaults to the OS cache dir. */
  cachePath?: string;
}

export interface ScanReport extends ScanResult {
  scannedCount: number;
  /**
   * Manifests that couldn't be parsed and were skipped (NFR-3.3). Not a finding — but they were
   * not checked, so with nothing worse found the exit code is 3 ("could not check"), never 0.
   */
  manifestErrors: ManifestParseError[];
  /** `${ecosystem}:${identifier}` -> every manifest path it was declared in. */
  sourcesByKey: Map<string, string[]>;
}

/**
 * The CLI-side half of FR-8.1: finds every manifest/lockfile under `rootDir` (thin
 * filesystem work), then hands the resulting identifiers to core's `scanDependencies()`
 * for every bit of actual detection logic — extraction, lockfile-fast-path lookup,
 * caching, registry calls, and rule evaluation all stay in `packages/core` per the "one
 * engine, thin adapters" invariant. This function owns no detection rule itself.
 */
export async function runScan(rootDir: string, options: RunScanOptions = {}): Promise<ScanReport> {
  const manifests = options.files ? classifyManifests(options.files) : discoverManifests(rootDir);
  const { deps, errors: manifestErrors } = extractAllDependencies(manifests);
  const targets = dedupeDependencies(deps);
  // A file-list scan (the pre-commit hook) must stay fast and never spawn Maven for a lockfile tree.
  const lockfileIndex = await buildScanLockfileIndex(
    rootDir,
    options.files ? { ...manifests, pomXml: [] } : manifests,
    { mavenTree: options.mavenTree === true && !options.files },
  );

  const { allowlist, config, configWarning } = loadProjectContext(rootDir);
  if (configWarning) process.stderr.write(`slopsquatshield: ${configWarning}\n`);

  const cache = new LazyRegistryCache(options.cachePath);
  try {
    const result = await scanDependencies(
      targets.map(({ identifier, ecosystem }) => ({ identifier, ecosystem })),
      {
        allowlist,
        thresholds: config.thresholds,
        privateScope: config.privateScope,
        lockfileIndex,
        cache,
        popularPackagesByEcosystem: {
          npm: POPULAR_NPM_PACKAGES,
          pypi: POPULAR_PYPI_PACKAGES,
          maven: POPULAR_MAVEN_COORDINATES,
        },
      },
    );
    const sourcesByKey = new Map(targets.map((t) => [`${t.ecosystem}:${t.identifier}`, t.sources]));
    return {
      ...result,
      exitCode: computeExitCode({
        verdicts: result.verdicts,
        unreachableCount: result.unreachable.length,
        manifestErrorCount: manifestErrors.length,
      }),
      scannedCount: targets.length,
      manifestErrors,
      sourcesByKey,
    };
  } finally {
    cache.close();
  }
}

export { EXIT_CODES };
