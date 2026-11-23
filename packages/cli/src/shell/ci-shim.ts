// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SHIM_DIR_ENV, launcherPath } from '../install/launcher.js';

const SHIM_TOOLS = ['npm', 'pip', 'mvn'] as const;

export function defaultCiShimDir(home: string = homedir()): string {
  return join(home, '.config', 'slopsquatshield', 'shims');
}

/**
 * Exports `SLOPSQUATSHIELD_SHIM_DIR` so the wrapper (`commands/install-wrapper.ts`) can take
 * the shim dir back off PATH before spawning the real tool. Without it the wrapper's own
 * `npm` lookup would find this shim first and recurse forever.
 */
function posixShim(tool: string, shimDir: string, launcher: string): string {
  const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
  return `#!/usr/bin/env sh\n${SHIM_DIR_ENV}=${q(shimDir)} exec ${q(launcher)} ${tool} "$@"\n`;
}

function cmdShim(tool: string, shimDir: string, launcher: string): string {
  return [
    '@echo off',
    `set "${SHIM_DIR_ENV}=${shimDir}"`,
    `"${launcher}" ${tool} %*`,
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
}

export interface CiShimOptions {
  shimDir?: string;
  home?: string;
  platform?: string;
}

/**
 * `--ci` mode (FR-11.2): non-interactive/CI shells never source `.bashrc`/`.zshrc`, so
 * the function-based wrapper (`shell/snippet.ts`) never loads there. Instead, this writes
 * real executable shim scripts named `npm`/`pip`/`mvn` (plus `.cmd` versions on Windows)
 * into `shimDir` — placing that directory earlier on `PATH` than the real binaries (a CI
 * config's own job; this function only creates the shims) makes every plain `npm`/`pip`/
 * `mvn` invocation resolve to these. Each shim calls the launcher by absolute path.
 */
export function createCiShims(options: CiShimOptions = {}): string[] {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const shimDir = options.shimDir ?? defaultCiShimDir(home);
  mkdirSync(shimDir, { recursive: true });

  const paths: string[] = [];
  for (const tool of SHIM_TOOLS) {
    // The extensionless POSIX shim serves Linux/macOS/WSL and Git Bash; the Windows launcher
    // path is the `.cmd`, so the POSIX one points at the sh script beside it.
    const shLauncher = launcherPath(home, 'linux');
    const path = join(shimDir, tool);
    writeFileSync(path, posixShim(tool, shimDir, shLauncher));
    chmodSync(path, 0o755);
    paths.push(path);

    if (platform === 'win32') {
      writeFileSync(
        join(shimDir, `${tool}.cmd`),
        cmdShim(tool, shimDir, launcherPath(home, platform)),
      );
    }
  }
  return paths;
}
