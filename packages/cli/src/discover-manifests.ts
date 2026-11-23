// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { type Dirent, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface DiscoveredManifests {
  packageJson: string[];
  requirementsTxt: string[];
  pyprojectToml: string[];
  pipfile: string[];
  pomXml: string[];
  packageLockJson: string[];
  poetryLock: string[];
  pipfileLock: string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.slopsquatshield-cache']);

function walk(dir: string, onFile: (path: string) => void): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), onFile);
    } else if (entry.isFile()) {
      onFile(join(dir, entry.name));
    }
  }
}

/**
 * Recursively finds every supported manifest and lockfile under `rootDir` (FR-8.1),
 * skipping `node_modules`/`.git`/build-output directories so a scan doesn't descend into
 * thousands of irrelevant nested `package.json` files. Manual recursion rather than
 * `fs.readdirSync(dir, { recursive: true })` specifically so those directories can be
 * skipped — the built-in recursive option has no exclusion mechanism.
 */
function emptyManifests(): DiscoveredManifests {
  return {
    packageJson: [],
    requirementsTxt: [],
    pyprojectToml: [],
    pipfile: [],
    pomXml: [],
    packageLockJson: [],
    poetryLock: [],
    pipfileLock: [],
  };
}

function classify(result: DiscoveredManifests, path: string): void {
  switch (basename(path)) {
    case 'package.json':
      result.packageJson.push(path);
      break;
    case 'requirements.txt':
      result.requirementsTxt.push(path);
      break;
    case 'pyproject.toml':
      result.pyprojectToml.push(path);
      break;
    case 'Pipfile':
      result.pipfile.push(path);
      break;
    case 'pom.xml':
      result.pomXml.push(path);
      break;
    case 'package-lock.json':
      result.packageLockJson.push(path);
      break;
    case 'poetry.lock':
      result.poetryLock.push(path);
      break;
    case 'Pipfile.lock':
      result.pipfileLock.push(path);
      break;
    default:
      break;
  }
}

/**
 * Recursively finds every supported manifest and lockfile under `rootDir` (FR-8.1),
 * skipping `node_modules`/`.git`/build-output directories so a scan doesn't descend into
 * thousands of irrelevant nested `package.json` files. Manual recursion rather than
 * `fs.readdirSync(dir, { recursive: true })` specifically so those directories can be
 * skipped — the built-in recursive option has no exclusion mechanism.
 */
export function discoverManifests(rootDir: string): DiscoveredManifests {
  const result = emptyManifests();
  walk(rootDir, (path) => classify(result, path));
  return result;
}

/**
 * Sorts an explicit list of file paths (e.g. the files staged for a commit, FR-20.2) into the
 * same buckets `discoverManifests` fills — without touching the rest of the tree. Anything that
 * isn't a supported manifest or lockfile is ignored.
 */
export function classifyManifests(files: readonly string[]): DiscoveredManifests {
  const result = emptyManifests();
  for (const file of files) classify(result, file);
  return result;
}
