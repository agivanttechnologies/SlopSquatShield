// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { classifyInstallCommand } from '../extractors/install-command.js';
import type { ExtractedDependency } from '../extractors/types.js';
import { parseNpmLockfile } from '../resolvers/lockfile/npm.js';
import { parsePipfileLock } from '../resolvers/lockfile/pipfile.js';
import { parsePoetryLock } from '../resolvers/lockfile/poetry.js';
import { type LockfileIndex, buildLockfileIndex, resolveViaLockfile } from '../resolvers/types.js';
import type { Verdict } from '../rules/types.js';
import { applyLockfilePin } from './lockfile-pin.js';
import type { ManifestParseError } from './manifest-error.js';
import { type ManifestReader, collectManifestInstall, displayPath } from './manifest-install.js';
import {
  type ScanDependenciesOptions,
  type UnreachableEntry,
  scanDependencies,
} from './scan-dependencies.js';

export interface InstallCheckOptions extends ScanDependenciesOptions {
  /** Directory the command runs in; `cd` is tracked from here. */
  cwd?: string;
  homeDir?: string;
  /** File access for manifest-driven installs. Without it they are reported "not verified". */
  reader?: ManifestReader;
  /** How long a cold-cache check may take before the rest is reported "not checked" (default 10 s). */
  budgetMs?: number;
}

export interface InstallCheckResult {
  /** False when the command is not an install at all — no I/O was done. */
  recognized: boolean;
  verdicts: Verdict[];
  unreachable: UnreachableEntry[];
  manifestErrors: ManifestParseError[];
  /** Manifests that were read, as paths for display. */
  manifestsChecked: string[];
  /** Plain-English reasons part of the install was *not* checked (fail-open, but never silent). */
  notVerified: string[];
}

const DEFAULT_BUDGET_MS = 10_000;

function lockfilePins(path: string, text: string) {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  if (name === 'package-lock.json' || name === 'npm-shrinkwrap.json') return parseNpmLockfile(text);
  if (name === 'poetry.lock') return parsePoetryLock(text);
  if (name === 'Pipfile.lock') return parsePipfileLock(text);
  return [];
}

/**
 * The one check every install-time surface shares (the agent hooks and the install wrapper): for
 * a shell command, decides which packages it will install — those it **names**, and, for an
 * install driven by a manifest (`npm install`, `npm ci`, `pip install -r f`, `uv sync`, `mvn test`),
 * those the project's manifest lists — and verifies them all.
 *
 * Why the second half matters: an agent that edits `package.json` with its file tool and then
 * runs a bare `npm install` named nothing on the command line, so nothing used to be checked.
 *
 * Fails open and says so: a manifest that cannot be read or parsed, a directory that cannot be
 * known (`cd "$X"`), a cap that was hit, or a registry that never answered all end up in
 * `notVerified` / `unreachable`, never in a silent "no findings". A time budget bounds a
 * cold-cache check of a large manifest so it can never stall an agent.
 */
export async function checkInstallCommand(
  command: string,
  options: InstallCheckOptions = {},
): Promise<InstallCheckResult> {
  const { named, manifestInstalls } = classifyInstallCommand(command, {
    includeXmlBlocks: false,
    cwd: options.cwd,
    homeDir: options.homeDir,
  });

  const result: InstallCheckResult = {
    recognized: named.length > 0 || manifestInstalls.length > 0,
    verdicts: [],
    unreachable: [],
    manifestErrors: [],
    manifestsChecked: [],
    notVerified: [],
  };
  if (!result.recognized) return result;

  // ---- what the manifest-driven installs will fetch ----------------------------------------
  const declared = new Map<string, { file: string; command: string }>();
  const lockfiles: string[] = [];
  const manifestDeps: ExtractedDependency[] = [];
  for (const install of manifestInstalls) {
    if (!options.reader) {
      result.notVerified.push(
        `\`${install.command}\` installs what the project's manifest lists, and file access is not available to check it`,
      );
      continue;
    }
    if (install.projectDir === undefined && !install.files?.length) {
      result.notVerified.push(
        `could not tell which directory \`${install.command}\` runs in, so its manifest was not checked`,
      );
      continue;
    }
    const collected = collectManifestInstall(install, options.reader, { homeDir: options.homeDir });
    result.manifestErrors.push(...collected.errors);
    result.notVerified.push(...collected.notes);
    for (const file of collected.files) {
      const shown = displayPath(file, options.cwd);
      if (!result.manifestsChecked.includes(shown)) result.manifestsChecked.push(shown);
    }
    lockfiles.push(...collected.lockfiles);
    for (const { dep, file } of collected.entries) {
      manifestDeps.push(dep);
      const key = `${dep.ecosystem}:${dep.name}`;
      if (!declared.has(key))
        declared.set(key, { file: displayPath(file, options.cwd), command: install.command });
    }
  }
  for (const err of result.manifestErrors) {
    result.notVerified.push(`could not parse ${err.message}`);
  }

  // ---- verify everything -----------------------------------------------------------------------
  const namedKeys = new Set(named.map((d) => `${d.ecosystem}:${d.name}`));
  const seen = new Set<string>();
  const targets: Array<{ identifier: string; ecosystem: ExtractedDependency['ecosystem'] }> = [];
  for (const dep of [...named, ...manifestDeps]) {
    const key = `${dep.ecosystem}:${dep.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ identifier: dep.name, ecosystem: dep.ecosystem });
  }

  const scan = await scanDependencies(targets, {
    ...options,
    deadline: options.deadline ?? Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS),
  });
  result.unreachable = scan.unreachable;

  // A name that a lockfile pins and the registry doesn't know is a private package or an edited
  // lockfile, not a hallucination (see `applyLockfilePin`). Only parsed when a package came back
  // as not-found, so the warm path never reads a lockfile.
  let pinIndex: LockfileIndex | undefined;
  const needsPins = scan.verdicts.some(
    (v) =>
      v.tier === 'BLOCK' &&
      v.signals.every((s) => s.type === 'non-existence') &&
      !namedKeys.has(`${v.ecosystem}:${v.identifier}`),
  );
  if (needsPins && options.reader && lockfiles.length > 0) {
    const reader = options.reader;
    pinIndex = buildLockfileIndex(
      lockfiles.flatMap((path) => {
        const text = reader.readFile(path);
        try {
          return text === undefined ? [] : lockfilePins(path, text);
        } catch {
          return [];
        }
      }),
    );
  }

  result.verdicts = scan.verdicts.map((verdict) => {
    const key = `${verdict.ecosystem}:${verdict.identifier}`;
    const origin = declared.get(key);
    if (namedKeys.has(key) || !origin) return verdict;
    const pinned = pinIndex
      ? resolveViaLockfile(verdict.identifier, pinIndex) !== undefined
      : false;
    const adjusted = applyLockfilePin(verdict, pinned, options.privateScope);
    if (adjusted.tier === 'CLEAN') return adjusted;
    return { ...adjusted, declaredIn: origin.file };
  });
  return result;
}
