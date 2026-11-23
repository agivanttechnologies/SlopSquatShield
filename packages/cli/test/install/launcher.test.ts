// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildCmdLauncher,
  buildPosixLauncher,
  buildPowerShellLauncher,
  inspectLauncher,
  launcherDir,
  launcherPath,
  refreshLauncherIfStale,
  windowsToWslPosix,
  writeLauncher,
  writeWslLauncher,
} from '../../src/install/launcher.js';
import { isEphemeralPath } from '../../src/install/self-location.js';

let homeDir: string;
const location = { nodePath: '/fake/node', entryPath: '/fake/dist/index.js', ephemeral: false };

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'ssg-launcher-'));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe('launcher content', () => {
  it('POSIX launcher records absolute Node + entry and execs them', () => {
    const text = buildPosixLauncher(location);
    expect(text).toContain("NODE='/fake/node'");
    expect(text).toContain("ENTRY='/fake/dist/index.js'");
    expect(text).toContain('exec "$NODE" "$ENTRY" "$@"');
  });

  it('quotes single quotes in recorded paths safely', () => {
    const text = buildPosixLauncher({ nodePath: "/o'brien/node", entryPath: '/x' });
    expect(text).toContain("NODE='/o'\\''brien/node'");
  });

  it('cmd and PowerShell launchers record the paths and fail open', () => {
    const cmd = buildCmdLauncher({ nodePath: 'C:\\n\\node.exe', entryPath: 'C:\\s\\index.js' });
    expect(cmd).toContain('set "NODE=C:\\n\\node.exe"');
    expect(cmd).toContain('exit /b 1');
    const ps1 = buildPowerShellLauncher({ nodePath: 'C:\\n\\node.exe', entryPath: 'C:\\s\\i.js' });
    expect(ps1).toContain("$Node = 'C:\\n\\node.exe'");
    expect(ps1).toContain("@('npm','pip','mvn')");
  });
});

describe('writeLauncher / inspectLauncher', () => {
  it('writes the POSIX launcher executable under ~/.config/slopsquatshield/bin, idempotently', () => {
    const path = writeLauncher({ home: homeDir, platform: 'linux', location });
    expect(path).toBe(launcherPath(homeDir, 'linux'));
    expect(readFileSync(path, 'utf-8')).toBe(buildPosixLauncher(location));
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o111).toBeGreaterThan(0);

    const mtime = statSync(path).mtimeMs;
    writeLauncher({ home: homeDir, platform: 'linux', location });
    expect(statSync(path).mtimeMs).toBe(mtime);
  });

  it('also writes .cmd and .ps1 launchers on Windows', () => {
    writeLauncher({ home: homeDir, platform: 'win32', location });
    expect(readFileSync(join(launcherDir(homeDir), 'slopsquatshield.cmd'), 'utf-8')).toContain(
      '@echo off',
    );
    expect(readFileSync(join(launcherDir(homeDir), 'slopsquatshield.ps1'), 'utf-8')).toContain(
      '$Node =',
    );
  });

  it('reports missing / ok / stale from the recorded paths', () => {
    expect(inspectLauncher(homeDir).state).toBe('missing');
    writeLauncher({ home: homeDir, platform: 'linux', location });
    expect(inspectLauncher(homeDir, () => true).state).toBe('ok');
    const stale = inspectLauncher(homeDir, () => false);
    expect(stale.state).toBe('stale');
    expect(stale.entryPath).toBe('/fake/dist/index.js');
  });
});

describe('refreshLauncherIfStale (self-heal)', () => {
  it('rewrites a stale launcher for a persistent install', () => {
    writeLauncher({ home: homeDir, platform: 'linux', location });
    const moved = { nodePath: process.execPath, entryPath: __filename, ephemeral: false };

    expect(refreshLauncherIfStale({ location: moved, home: homeDir, platform: 'linux' })).toBe(
      true,
    );
    expect(inspectLauncher(homeDir).state).toBe('ok');
  });

  it('leaves a healthy launcher alone', () => {
    const real = { nodePath: process.execPath, entryPath: __filename, ephemeral: false };
    writeLauncher({ home: homeDir, platform: 'linux', location: real });
    expect(refreshLauncherIfStale({ location: real, home: homeDir, platform: 'linux' })).toBe(
      false,
    );
  });

  it('never rewrites from an ephemeral (npx) install', () => {
    writeLauncher({ home: homeDir, platform: 'linux', location });
    expect(
      refreshLauncherIfStale({
        location: { ...location, ephemeral: true },
        home: homeDir,
        platform: 'linux',
      }),
    ).toBe(false);
  });
});

describe('WSL launcher', () => {
  it('translates a Windows node.exe path to its /mnt mount, keeps the entry as a Windows path', () => {
    expect(windowsToWslPosix('C:\\Program Files\\nodejs\\node.exe')).toBe(
      '/mnt/c/Program Files/nodejs/node.exe',
    );

    const wslHome = mkdtempSync(join(tmpdir(), 'ssg-wsl-launcher-'));
    try {
      const calls: Array<[string, string]> = [];
      const posix = writeWslLauncher({
        distro: 'Ubuntu',
        windowsHome: wslHome,
        posixHome: '/home/user',
        location: { nodePath: 'C:\\n\\node.exe', entryPath: 'C:\\s\\index.js', ephemeral: false },
        chmodExecutable: (distro, path) => calls.push([distro, path]),
      });

      expect(posix).toBe('/home/user/.config/slopsquatshield/bin/slopsquatshield');
      expect(calls).toEqual([['Ubuntu', '/home/user/.config/slopsquatshield/bin/slopsquatshield']]);
      const text = readFileSync(join(launcherDir(wslHome), 'slopsquatshield'), 'utf-8');
      expect(text).toContain("NODE='/mnt/c/n/node.exe'");
      expect(text).toContain("ENTRY='C:\\s\\index.js'");
      expect(text).not.toContain('\r');
    } finally {
      rmSync(wslHome, { recursive: true, force: true });
    }
  });
});

describe('isEphemeralPath', () => {
  it.each([
    '/home/a/.npm/_npx/abc123/node_modules/slopsquatshield/dist/index.js',
    'C:\\Users\\a\\AppData\\Local\\pnpm\\dlx\\x\\node_modules\\y',
    '/run/user/1000/fnm_multishells/123_456/bin/node',
  ])('flags %s', (p) => expect(isEphemeralPath(p)).toBe(true));

  it.each([
    '/home/a/.nvm/versions/node/v24.21.0/lib/node_modules/slopsquatshield/dist/index.js',
    '/opt/homebrew/bin/node',
  ])('does not flag %s', (p) => expect(isEphemeralPath(p)).toBe(false));
});

// Real-shell behavior of the generated sh launcher — POSIX only (Windows hosts use .cmd/.ps1).
describe.skipIf(process.platform === 'win32')('POSIX launcher in a real minimal shell', () => {
  function runLauncher(args: string[], env: NodeJS.ProcessEnv) {
    return spawnSync('sh', [launcherPath(homeDir, 'linux'), ...args], { env, encoding: 'utf-8' });
  }

  it('runs the recorded Node + entry with only a bare system PATH (the nvm exit-127 case)', () => {
    const entry = join(homeDir, 'cli.js');
    writeFileSync(entry, 'console.log("ran:" + process.argv.slice(2).join(","));');
    writeLauncher({
      home: homeDir,
      platform: 'linux',
      location: { nodePath: process.execPath, entryPath: entry, ephemeral: false },
    });

    const result = runLauncher(['hook', 'claude-code'], { HOME: homeDir, PATH: '/usr/bin:/bin' });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('ran:hook,claude-code');
  });

  it('fails open when stale: hook exits 1 with a repair message', () => {
    writeLauncher({ home: homeDir, platform: 'linux', location });
    const result = runLauncher(['hook', 'claude-code'], { HOME: homeDir, PATH: '/usr/bin:/bin' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('launcher is stale');
    expect(result.stderr).toContain('slopsquatshield init');
  });

  it('fails open when stale: npm passes straight through to the real tool, off the shim dir', () => {
    writeLauncher({ home: homeDir, platform: 'linux', location });
    const shimDir = join(homeDir, 'shims');
    const realDir = join(homeDir, 'real');
    mkdirSync(shimDir);
    mkdirSync(realDir);
    // A shim `npm` that would recurse, and the real one that should be reached.
    writeFileSync(join(shimDir, 'npm'), '#!/bin/sh\necho SHIM\n');
    writeFileSync(join(realDir, 'npm'), '#!/bin/sh\necho "REAL $*"\n');
    chmodSync(join(shimDir, 'npm'), 0o755);
    chmodSync(join(realDir, 'npm'), 0o755);

    const result = runLauncher(['npm', 'install', 'left-pad'], {
      HOME: homeDir,
      PATH: `${shimDir}:${launcherDir(homeDir)}:${realDir}:/usr/bin:/bin`,
      SLOPSQUATSHIELD_SHIM_DIR: shimDir,
    });

    expect(result.stdout.trim()).toBe('REAL install left-pad');
    expect(result.stderr).toContain('launcher is stale');
  });

  it('fails open when stale with the default CI shim dir on PATH and no shim variable: one message, real tool (#3)', () => {
    writeLauncher({ home: homeDir, platform: 'linux', location });
    // The default shim dir is bin/'s sibling; a shell function (unlike a shim) sets no variable.
    const shimDir = join(launcherDir(homeDir), '..', 'shims');
    const realDir = join(homeDir, 'real');
    mkdirSync(shimDir, { recursive: true });
    mkdirSync(realDir);
    writeFileSync(join(shimDir, 'npm'), '#!/bin/sh\necho SHIM\n');
    writeFileSync(join(realDir, 'npm'), '#!/bin/sh\necho "REAL $*"\n');
    chmodSync(join(shimDir, 'npm'), 0o755);
    chmodSync(join(realDir, 'npm'), 0o755);

    const result = runLauncher(['npm', 'install', 'left-pad'], {
      HOME: homeDir,
      PATH: `${resolve(shimDir)}:${realDir}:/usr/bin:/bin`,
    });

    expect(result.stdout.trim()).toBe('REAL install left-pad');
    expect(result.stderr.match(/launcher is stale/g)).toHaveLength(1);
    // Useful after `npm uninstall -g` too, not only after a Node switch.
    expect(result.stderr).toContain('Reinstall it');
    expect(result.stderr).toContain('remove SlopSquatShield');
  });

  it('falls back to a slopsquatshield on PATH when the recorded paths are gone', () => {
    writeLauncher({ home: homeDir, platform: 'linux', location });
    const binDir = join(homeDir, 'pathbin');
    mkdirSync(binDir);
    writeFileSync(join(binDir, 'slopsquatshield'), '#!/bin/sh\necho "via-path $*"\n');
    chmodSync(join(binDir, 'slopsquatshield'), 0o755);

    const result = runLauncher(['scan'], {
      HOME: homeDir,
      PATH: `${launcherDir(homeDir)}:${binDir}:/usr/bin:/bin`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('via-path scan');
  });

  it('is valid sh (syntax check)', () => {
    writeLauncher({ home: homeDir, platform: 'linux', location });
    expect(() => execFileSync('sh', ['-n', launcherPath(homeDir, 'linux')])).not.toThrow();
  });
});
