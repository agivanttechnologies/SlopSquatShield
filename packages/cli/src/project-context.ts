// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIG_FILE_NAME,
  type SlopSquatConfig,
  parseAllowlist,
  resolveConfig,
} from '@slopsquatshield/core';

/** Everything a project can tell the engine: its allowlist and its configuration. */
export interface ProjectContext {
  allowlist: ReadonlySet<string> | undefined;
  config: SlopSquatConfig;
  /** Set when the configuration was unusable and defaults were used instead (NFR-3.1). */
  configWarning: string | undefined;
}

function readIfPresent(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
  } catch {
    return undefined; // unreadable is treated as absent — never a reason to stop a scan or a hook
  }
}

/**
 * Reads `<dir>/.slopsquatshield` (FR-5.1) and the project configuration — `.slopsquatshieldrc`,
 * or the `slopsquatshield` key in `package.json` (FR-4.1/FR-6.1). Every CLI surface (scan,
 * install wrapper, agent hooks, pre-commit) loads both through here, so they cannot drift from
 * one another (FR-5.2). File reading is this thin adapter's job; parsing and validation are core's.
 */
export function loadProjectContext(dir: string): ProjectContext {
  const allowlistText = readIfPresent(join(dir, '.slopsquatshield'));
  const rcPath = join(dir, CONFIG_FILE_NAME);
  const rcText = readIfPresent(rcPath);
  const pkgPath = join(dir, 'package.json');
  const pkgText = readIfPresent(pkgPath);

  const resolved = resolveConfig({
    rc: rcText === undefined ? undefined : { fileName: rcPath, text: rcText },
    packageJson: pkgText === undefined ? undefined : { fileName: pkgPath, text: pkgText },
  });

  return {
    allowlist: allowlistText === undefined ? undefined : parseAllowlist(allowlistText),
    config: resolved.config,
    configWarning: resolved.warning,
  };
}
