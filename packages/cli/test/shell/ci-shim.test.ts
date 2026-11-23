// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHIM_DIR_ENV, launcherPath } from '../../src/install/launcher.js';
import { createCiShims } from '../../src/shell/ci-shim.js';

/** Translates a Windows path to its WSL-mounted equivalent, e.g. C:\foo\bar -> /mnt/c/foo/bar. */
function toWslPath(windowsPath: string): string {
  const match = /^([A-Za-z]):\\(.*)$/.exec(windowsPath);
  if (!match) return windowsPath.replace(/\\/g, '/');
  const [, drive, rest] = match;
  return `/mnt/${drive.toLowerCase()}/${rest.replace(/\\/g, '/')}`;
}

let tmpDir: string;
let homeDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ssg-ci-shim-'));
  homeDir = mkdtempSync(join(tmpdir(), 'ssg-ci-shim-home-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

describe('createCiShims', () => {
  it('creates npm/pip/mvn scripts that call the launcher by absolute path', () => {
    const paths = createCiShims({ shimDir: tmpDir, home: homeDir, platform: 'linux' });

    expect(paths.map((p) => basename(p))).toEqual(['npm', 'pip', 'mvn']);
    for (const path of paths) {
      const text = readFileSync(path, 'utf-8');
      expect(text).toContain(launcherPath(homeDir, 'linux'));
      expect(text).not.toMatch(/exec slopsquatshield/);
    }
  });

  it('exports the shim dir so the wrapper can remove it from PATH (no recursion)', () => {
    const [npmShim] = createCiShims({ shimDir: tmpDir, home: homeDir, platform: 'linux' });
    expect(readFileSync(npmShim, 'utf-8')).toContain(`${SHIM_DIR_ENV}='${tmpDir}'`);
  });

  it('also writes .cmd shims on Windows', () => {
    createCiShims({ shimDir: tmpDir, home: homeDir, platform: 'win32' });
    for (const tool of ['npm', 'pip', 'mvn']) {
      const cmd = readFileSync(join(tmpDir, `${tool}.cmd`), 'utf-8');
      expect(cmd).toContain(`set "${SHIM_DIR_ENV}=${tmpDir}"`);
      expect(cmd).toContain(`slopsquatshield.cmd" ${tool} %*`);
    }
  });

  it('sets the executable bit on POSIX', () => {
    const [npmShim] = createCiShims({ shimDir: tmpDir, home: homeDir, platform: 'linux' });
    expect(existsSync(npmShim)).toBe(true);
    if (process.platform === 'win32') return; // NTFS has no POSIX mode bits to check
    expect((statSync(npmShim).mode % 512) & 0o111).toBeGreaterThan(0);
  });

  it("resolves to the shim, not the real binary, when it's first on PATH (real non-interactive shell)", () => {
    // POSIX-CI feature; Windows runners' bash is Git Bash with different path translation.
    if (process.platform === 'win32') return;

    createCiShims({ shimDir: tmpDir, home: homeDir, platform: 'linux' });

    const wslShimDir = toWslPath(tmpDir);
    const output = execFileSync('bash', ['-c', `PATH="${wslShimDir}:$PATH" command -v npm`], {
      encoding: 'utf-8',
    });

    expect(output.trim()).toBe(`${wslShimDir}/npm`);
  });
});
