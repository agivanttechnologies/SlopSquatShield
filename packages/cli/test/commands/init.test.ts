// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../../src/commands/init.js';
import { claudeCodeSettingsPath } from '../../src/hooks/claude-code-config.js';
import { cursorHooksConfigPath } from '../../src/hooks/cursor-config.js';
import { launcherPath } from '../../src/install/launcher.js';
import {
  bashProfilePath,
  powerShellProfiles,
  zshProfilePath,
} from '../../src/shell/profile-paths.js';

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ssg-init-project-'));
  homeDir = mkdtempSync(join(tmpdir(), 'ssg-init-home-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

// Every --shell call below passes detectWslHome explicitly (even () => undefined) so tests
// never spawn a real wsl.exe — the project rule: "never let a test reach real machine
// state through an implicit default".
const noWsl = () => undefined;
const noDocumentsDir = () => undefined; // never spawn a real powershell.exe
const location = { nodePath: '/fake/node', entryPath: '/fake/dist/index.js', ephemeral: false };
// Passed on every call so no test reaches real machine state (home, launcher, wsl.exe).
// Pinned so the launcher written (and `launcherPath` read back) is the POSIX one on every OS —
// on a Windows runner `process.platform` would otherwise switch both to the `.cmd` launcher.
const base = () => ({
  home: homeDir,
  selfLocation: location,
  detectWslHome: noWsl,
  detectDocumentsDir: noDocumentsDir,
  platform: 'linux',
});

describe('runInit', () => {
  it('does not walk the home directory looking for a project (#8)', () => {
    // A manifest buried somewhere under ~ must not be reported as "this" project's ecosystem.
    mkdirSync(join(homeDir, 'some', 'other-project'), { recursive: true });
    writeFileSync(join(homeDir, 'some', 'other-project', 'package.json'), '{}');

    const result = runInit(homeDir, base());

    expect(result.detectedEcosystems).toEqual([]);
  });

  it('detects the project ecosystem from manifests present', () => {
    writeFileSync(join(projectDir, 'package.json'), '{}');
    writeFileSync(join(projectDir, 'requirements.txt'), '');

    const result = runInit(projectDir);

    expect(result.detectedEcosystems.sort()).toEqual(['npm', 'pypi']);
  });

  it('creates .slopsquatshield when absent, and is idempotent on a second run', () => {
    const first = runInit(projectDir);
    expect(first.allowlist).toBe('created');

    const second = runInit(projectDir);
    expect(second.allowlist).toBe('already-existed');
  });

  it('installs the shell wrapper into bash/zsh/PowerShell profiles when --shell is passed', () => {
    const result = runInit(projectDir, { ...base(), shell: true });

    expect(result.shell).toEqual({
      bash: 'installed',
      zsh: 'installed',
      powershell: [
        {
          label: 'PowerShell',
          path: powerShellProfiles({ home: homeDir, platform: 'linux' })[0].path,
          result: 'installed',
        },
      ],
    });
    expect(readFileSync(bashProfilePath(homeDir), 'utf-8')).toContain(
      '"$HOME/.config/slopsquatshield/bin/slopsquatshield" npm "$@"',
    );
  });

  describe('PowerShell profiles on Windows', () => {
    const win = () => ({ ...base(), platform: 'win32' });

    it('writes both PowerShell 7 and Windows PowerShell 5.1, creating the folders', () => {
      const result = runInit(projectDir, { ...win(), shell: true });

      const [pwsh7, ps51] = powerShellProfiles({ home: homeDir, platform: 'win32' });
      expect(result.shell?.powershell).toEqual([
        { label: 'PowerShell 7', path: pwsh7.path, result: 'installed' },
        { label: 'Windows PowerShell 5.1', path: ps51.path, result: 'installed' },
      ]);
      expect(ps51.path).toContain('WindowsPowerShell');
      for (const { path } of [pwsh7, ps51]) {
        expect(readFileSync(path, 'utf-8')).toContain('function npm');
      }
    });

    it('writes into the Documents folder Windows reports, not <home>\\Documents', () => {
      const redirected = mkdtempSync(join(tmpdir(), 'ssg-init-onedrive-'));
      try {
        const result = runInit(projectDir, {
          ...win(),
          shell: true,
          detectDocumentsDir: () => redirected,
        });

        for (const entry of result.shell?.powershell ?? []) {
          expect(entry.path.startsWith(redirected)).toBe(true);
          expect(existsSync(entry.path)).toBe(true);
        }
        expect(existsSync(join(homeDir, 'Documents'))).toBe(false);
      } finally {
        rmSync(redirected, { recursive: true, force: true });
      }
    });

    it('falls back to <home>\\Documents when Windows cannot be asked', () => {
      const result = runInit(projectDir, { ...win(), shell: true });
      for (const entry of result.shell?.powershell ?? []) {
        expect(entry.path.startsWith(join(homeDir, 'Documents'))).toBe(true);
      }
    });

    it('is idempotent across both profiles', () => {
      runInit(projectDir, { ...win(), shell: true });
      const second = runInit(projectDir, { ...win(), shell: true });
      expect(second.shell?.powershell.map((p) => p.result)).toEqual([
        'already-installed',
        'already-installed',
      ]);
    });
  });

  it('does not touch shell profiles when --shell is omitted', () => {
    const result = runInit(projectDir, base());
    expect(result.shell).toBeUndefined();
    expect(result.launcher).toBeUndefined();
  });

  it('writes the Claude Code hook into the user-level config by default', () => {
    const result = runInit(projectDir, { ...base(), claudeCode: true });

    expect(result.claudeCodeHook).toBe('installed');
    expect(readFileSync(claudeCodeSettingsPath(homeDir), 'utf-8')).toContain(
      '"$HOME/.config/slopsquatshield/bin/slopsquatshield\\" hook claude-code',
    );
    expect(existsSync(claudeCodeSettingsPath(projectDir))).toBe(false);
  });

  it('writes the hook into the project instead with --project', () => {
    const result = runInit(projectDir, {
      ...base(),
      claudeCode: true,
      cursor: true,
      project: true,
    });

    expect(result.claudeCodeHook).toBe('installed');
    expect(result.cursorHook).toBe('installed');
    expect(existsSync(claudeCodeSettingsPath(projectDir))).toBe(true);
    expect(existsSync(cursorHooksConfigPath(projectDir))).toBe(true);
    expect(existsSync(claudeCodeSettingsPath(homeDir))).toBe(false);
  });

  it('writes the Cursor hook config (absolute launcher path) when --cursor is passed', () => {
    const result = runInit(projectDir, { ...base(), cursor: true });

    expect(result.cursorHook).toBe('installed');
    const text = readFileSync(cursorHooksConfigPath(homeDir), 'utf-8');
    expect(text).toContain('hook cursor');
    expect(text).toContain('slopsquatshield');
  });

  it('works when the home dir holds an allowlist FILE named .slopsquatshield (init run from ~)', () => {
    // Running `init` from ~ creates exactly this file; the launcher dir once collided
    // with it (ENOTDIR). Tool-owned files live under ~/.config/slopsquatshield instead.
    writeFileSync(join(homeDir, '.slopsquatshield'), '# allowlist\n');

    const result = runInit(homeDir, { ...base(), shell: true, claudeCode: true, ci: true });

    expect(result.launcher?.status).toBe('written');
    expect(readFileSync(join(homeDir, '.slopsquatshield'), 'utf-8')).toBe('# allowlist\n');
    expect(readFileSync(launcherPath(homeDir, 'linux'), 'utf-8')).toContain("NODE='/fake/node'");
    expect(result.ciShims).toHaveLength(3);
  });

  it('writes the stable launcher whenever any surface is requested', () => {
    const result = runInit(projectDir, { ...base(), claudeCode: true });

    expect(result.launcher?.status).toBe('written');
    const text = readFileSync(launcherPath(homeDir, 'linux'), 'utf-8');
    expect(text).toContain("NODE='/fake/node'");
    expect(text).toContain("ENTRY='/fake/dist/index.js'");
  });

  it('upgrades a legacy bare-name hook and shell snippet in place on re-run', () => {
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(
      claudeCodeSettingsPath(homeDir),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'slopsquatshield hook claude-code' }],
            },
          ],
        },
      }),
    );
    writeFileSync(
      bashProfilePath(homeDir),
      '# >>> slopsquatshield shell wrapper >>>\nnpm() { slopsquatshield npm "$@"; }\n# <<< slopsquatshield shell wrapper <<<\n',
    );

    const result = runInit(projectDir, { ...base(), claudeCode: true, shell: true });

    expect(result.claudeCodeHook).toBe('upgraded');
    expect(result.shell?.bash).toBe('upgraded');
    const settings = JSON.parse(readFileSync(claudeCodeSettingsPath(homeDir), 'utf-8'));
    expect(settings.hooks.PreToolUse[0].hooks).toHaveLength(1);
  });

  it('leaves an invalid-JSON settings file untouched and says so', () => {
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(claudeCodeSettingsPath(homeDir), '{ broken');

    const result = runInit(projectDir, { ...base(), claudeCode: true });

    expect(result.claudeCodeHook).toBe('invalid-json');
    expect(readFileSync(claudeCodeSettingsPath(homeDir), 'utf-8')).toBe('{ broken');
  });

  it('refuses to write a launcher or any config from an ephemeral (npx) install', () => {
    const result = runInit(projectDir, {
      ...base(),
      selfLocation: { ...location, ephemeral: true },
      shell: true,
      claudeCode: true,
    });

    expect(result.launcher?.status).toBe('refused-ephemeral');
    expect(result.shell).toBeUndefined();
    expect(result.claudeCodeHook).toBeUndefined();
    expect(existsSync(launcherPath(homeDir))).toBe(false);
    expect(existsSync(bashProfilePath(homeDir))).toBe(false);
  });

  it('creates CI PATH shims when --ci is passed', () => {
    const shimDir = join(projectDir, 'shims');
    const result = runInit(projectDir, { ...base(), ci: true, ciShimDir: shimDir });

    expect(result.ciShims).toHaveLength(3);
    for (const path of result.ciShims ?? []) {
      expect(readFileSync(path, 'utf-8')).toContain(launcherPath(homeDir, 'linux'));
    }
  });

  it('re-running with the same options twice is fully idempotent end-to-end', () => {
    runInit(projectDir, { ...base(), shell: true, claudeCode: true });
    const second = runInit(projectDir, { ...base(), shell: true, claudeCode: true });

    expect(second.allowlist).toBe('already-existed');
    expect(second.shell).toEqual({
      bash: 'already-installed',
      zsh: 'already-installed',
      powershell: [
        {
          label: 'PowerShell',
          path: powerShellProfiles({ home: homeDir, platform: 'linux' })[0].path,
          result: 'already-installed',
        },
      ],
    });
    expect(second.claudeCodeHook).toBe('already-installed');
  });

  describe('WSL detection', () => {
    it('also installs the bash/zsh snippet into the WSL home when a distro is detected', () => {
      const wslHomeDir = mkdtempSync(join(tmpdir(), 'ssg-init-wsl-home-'));
      try {
        const result = runInit(projectDir, {
          ...base(),
          shell: true,
          claudeCode: true,
          chmodWsl: () => {},
          detectWslHome: () => ({
            distro: 'Ubuntu',
            posixPath: '/home/user',
            windowsPath: wslHomeDir,
          }),
        });

        expect(result.shell?.wsl).toEqual({
          distro: 'Ubuntu',
          bash: 'installed',
          zsh: 'installed',
        });
        expect(readFileSync(bashProfilePath(wslHomeDir), 'utf-8')).toContain('npm() {');
        expect(readFileSync(zshProfilePath(wslHomeDir), 'utf-8')).toContain('npm() {');
        expect(readFileSync(bashProfilePath(homeDir), 'utf-8')).toContain('npm() {');
        // The distro gets its own launcher and its own user-level Claude Code hook.
        expect(readFileSync(launcherPath(wslHomeDir, 'linux'), 'utf-8')).toContain('NODE=');
        expect(result.claudeCodeHookWsl).toBe('installed');
        expect(readFileSync(claudeCodeSettingsPath(wslHomeDir), 'utf-8')).toContain(
          'hook claude-code',
        );
      } finally {
        rmSync(wslHomeDir, { recursive: true, force: true });
      }
    });

    it('omits the wsl field entirely when no distro is detected', () => {
      const result = runInit(projectDir, { ...base(), shell: true });
      expect(result.shell?.wsl).toBeUndefined();
    });

    it('is idempotent for the WSL install on a second run', () => {
      const wslHomeDir = mkdtempSync(join(tmpdir(), 'ssg-init-wsl-home-'));
      try {
        const detectWslHome = () => ({
          distro: 'Ubuntu',
          posixPath: '/home/user',
          windowsPath: wslHomeDir,
        });
        const opts = { ...base(), shell: true, chmodWsl: () => {}, detectWslHome };
        runInit(projectDir, opts);
        const second = runInit(projectDir, opts);

        expect(second.shell?.wsl).toEqual({
          distro: 'Ubuntu',
          bash: 'already-installed',
          zsh: 'already-installed',
        });
      } finally {
        rmSync(wslHomeDir, { recursive: true, force: true });
      }
    });
  });
});

describe('runInit — Codex, Antigravity and --all', () => {
  const opts = () => ({
    home: homeDir,
    selfLocation: location,
    detectWslHome: noWsl,
    platform: 'linux',
  });

  it('--codex writes ~/.codex/hooks.json; --antigravity writes ~/.gemini/config/hooks.json', () => {
    const result = runInit(projectDir, { ...opts(), codex: true, antigravity: true });

    expect(result.codexHook).toBe('installed');
    expect(result.antigravityHook).toBe('installed');
    expect(readFileSync(join(homeDir, '.codex', 'hooks.json'), 'utf-8')).toContain('hook codex');
    expect(readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf-8')).toContain(
      'hook antigravity',
    );
  });

  it('--project writes the project-level files instead (.codex/, .agents/)', () => {
    runInit(projectDir, { ...opts(), codex: true, antigravity: true, project: true });

    expect(existsSync(join(projectDir, '.codex', 'hooks.json'))).toBe(true);
    expect(existsSync(join(projectDir, '.agents', 'hooks.json'))).toBe(true);
    expect(existsSync(join(homeDir, '.codex', 'hooks.json'))).toBe(false);
  });

  it('--all writes the shell wrapper plus only the hosts whose config dir exists', () => {
    mkdirSync(join(homeDir, '.claude'));
    mkdirSync(join(homeDir, '.codex'));

    const result = runInit(projectDir, { ...opts(), all: true });

    expect(result.detectedHosts?.sort()).toEqual(['claudeCode', 'codex']);
    expect(result.shell?.bash).toBe('installed');
    expect(result.claudeCodeHook).toBe('installed');
    expect(result.codexHook).toBe('installed');
    expect(result.cursorHook).toBeUndefined();
    expect(result.antigravityHook).toBeUndefined();
    expect(existsSync(join(homeDir, '.cursor'))).toBe(false);
  });

  it('--all also detects a host from the project dir (.cursor/, .agents/)', () => {
    mkdirSync(join(projectDir, '.cursor'));
    mkdirSync(join(projectDir, '.agents'));

    const result = runInit(projectDir, { ...opts(), all: true });

    expect(result.detectedHosts?.sort()).toEqual(['antigravity', 'cursor']);
  });

  it('--all with no agent hosts installed still sets up the shell wrapper, and nothing else', () => {
    const result = runInit(projectDir, { ...opts(), all: true });

    expect(result.detectedHosts).toEqual([]);
    expect(result.shell?.bash).toBe('installed');
    expect(result.claudeCodeHook).toBeUndefined();
  });

  it('an explicit flag forces a host that --all did not find', () => {
    const result = runInit(projectDir, { ...opts(), all: true, cursor: true });
    expect(result.cursorHook).toBe('installed');
  });

  it('--all is idempotent', () => {
    mkdirSync(join(homeDir, '.codex'));
    runInit(projectDir, { ...opts(), all: true });
    const second = runInit(projectDir, { ...opts(), all: true });

    expect(second.codexHook).toBe('already-installed');
    expect(second.shell?.bash).toBe('already-installed');
  });

  it('also writes the WSL distro’s own ~/.codex when WSL is detected', () => {
    const wslHome = mkdtempSync(join(tmpdir(), 'ssg-init-wsl-codex-'));
    try {
      const result = runInit(projectDir, {
        ...opts(),
        codex: true,
        chmodWsl: () => {},
        detectWslHome: () => ({ distro: 'Ubuntu', posixPath: '/home/user', windowsPath: wslHome }),
      });

      expect(result.codexHookWsl).toBe('installed');
      expect(readFileSync(join(wslHome, '.codex', 'hooks.json'), 'utf-8')).toContain(
        '"/home/user/.config/slopsquatshield/bin/slopsquatshield\\" hook codex',
      );
    } finally {
      rmSync(wslHome, { recursive: true, force: true });
    }
  });
});
