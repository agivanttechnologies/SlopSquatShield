// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findOnPath } from '../../exec/find-on-path.js';
import type { LockfilePin } from '../types.js';

const execFileAsync = promisify(execFile);

const TREE_CONNECTOR_PATTERN = /[+\\]-/;
const COORDINATE_PATTERN = /([\w.-]+):([\w.-]+):[\w.-]+:([\w.-]+)(?::[\w.-]+)?\s*$/;
/** `[WARNING] The POM for g:a:jar:v is missing, no dependency information available` (or `is invalid`). */
const UNRESOLVED_POM_PATTERN =
  /The POM for ([\w.-]+):([\w.-]+):[\w.-]+:[\w.-]+ is (?:missing|invalid)/;

/**
 * Parses `mvn dependency:tree -DoutputType=text` output (FR-3.4). Maven has no lockfile
 * format of its own, so the effective dependency tree — every coordinate Maven actually
 * resolved against a real repository to build it — serves the same fast-path role: a
 * `groupId:artifactId` appearing here was already verified to exist at resolution time.
 * Only lines with a tree connector (`+-`/`\-`, at any indentation depth) are treated as
 * dependencies — the first, unindented line is the project's own coordinate, not one of
 * its dependencies, and is deliberately excluded.
 *
 * A tree line alone is NOT proof of existence: when a dependency's POM cannot be found,
 * Maven warns "The POM for … is missing", still lists the coordinate in the tree, and exits
 * 0 (verified against Maven 3.9.9). Any coordinate named in such a warning is left out, so it
 * falls through to the Maven Central check — otherwise every hallucinated Maven dependency
 * would pass as "pinned" on any machine that has Maven installed.
 */
export function parseMavenDependencyTree(text: string): LockfilePin[] {
  const lines = text.split('\n');
  const unresolved = new Set<string>();
  for (const line of lines) {
    const match = UNRESOLVED_POM_PATTERN.exec(line);
    if (match) unresolved.add(`${match[1]}:${match[2]}`);
  }

  const pins: LockfilePin[] = [];
  for (const line of lines) {
    if (!TREE_CONNECTOR_PATTERN.test(line)) continue;
    const match = COORDINATE_PATTERN.exec(line.trim());
    if (!match) continue;
    const [, groupId, artifactId, version] = match;
    const name = `${groupId}:${artifactId}`;
    if (unresolved.has(name)) continue;
    pins.push({ name, version });
  }
  return pins;
}

/**
 * Runs `mvn dependency:tree` in `cwd` and parses its output (FR-3.4). No Maven on PATH,
 * or any other failure, fails open to an empty result (NFR-3.1) rather than throwing —
 * the caller falls through to the network-backed Maven Central client instead.
 *
 * **This runs code the project controls**: Maven applies the project's `.mvn/jvm.config`,
 * `.mvn/maven.config` and `.mvn/extensions.xml`, and builds the POM, loading the build extensions
 * and plugins it declares. Callers must only reach it on the user's explicit request (the CLI's
 * `scan --maven-tree`), never by default on a project that may be untrusted. `mvn` is resolved from
 * `PATH` here so the project directory can never supply the binary itself.
 */
export async function getMavenDependencyTreePins(cwd: string): Promise<LockfilePin[]> {
  const mvn = findOnPath('mvn');
  if (!mvn) return [];
  try {
    const { stdout } = await execFileAsync(mvn, ['dependency:tree', '-DoutputType=text'], {
      cwd,
    });
    return parseMavenDependencyTree(stdout);
  } catch {
    return [];
  }
}
