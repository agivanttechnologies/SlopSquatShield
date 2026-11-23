// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDoctor } from '../../src/commands/doctor.js';
import { runInit } from '../../src/commands/init.js';
import { claudeCodeSettingsPath } from '../../src/hooks/claude-code-config.js';
import { bashProfilePath, powerShellProfiles } from '../../src/shell/profile-paths.js';

let projectDir: string;
let homeDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'ssg-doctor-project-'));
  homeDir = mkdtempSync(join(tmpdir(), 'ssg-doctor-home-'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

// Every runDoctor/runInit call passes detectWslHome, home, and a stubbed hook runner so tests
// never spawn a real wsl.exe or a real hook — the project rule: "never let a test reach
// real machine state through an implicit default".
const noWsl = () => undefined;
const noDocumentsDir = () => undefined; // never spawn a real powershell.exe
const location = { nodePath: '/fake/node', entryPath: '/fake/dist/index.js', ephemeral: false };
const hookOk = vi.fn(async () => ({ code: 0, stdout: '{}', stderr: '' }));

// Same platform as doctorOpts — otherwise a Windows runner writes `.cmd` hook commands that a
// 'linux' doctor correctly reports as outdated.
const initBase = () => ({
  home: homeDir,
  selfLocation: location,
  detectWslHome: noWsl,
  detectDocumentsDir: noDocumentsDir,
  platform: 'linux',
});
const doctorOpts = () => ({
  home: homeDir,
  cachePath: ':memory:',
  detectWslHome: noWsl,
  detectDocumentsDir: noDocumentsDir,
  runHookCommand: hookOk,
  pathExists: () => true,
  platform: 'linux',
  selfLocation: location,
});

function findCheck(report: Awaited<ReturnType<typeof runDoctor>>, surface: string) {
  const check = report.checks.find((c) => c.surface === surface);
  if (!check) throw new Error(`No check found for surface: ${surface}`);
  return check;
}

describe('runDoctor', () => {
  it('flags a missing allowlist with the exact fix command', async () => {
    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Allowlist');

    expect(check.status).toBe('missing');
    expect(check.fixCommand).toBe('slopsquatshield init');
  });

  it('reports the allowlist as ok once init has created it', async () => {
    runInit(projectDir, initBase());
    expect(findCheck(await runDoctor(projectDir, doctorOpts()), 'Allowlist').status).toBe('ok');
  });

  it('flags a missing Claude Code hook with the exact fix command', async () => {
    mkdirSync(join(homeDir, '.claude')); // Claude Code is installed, just not hooked up yet
    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Claude Code hook');

    expect(check.status).toBe('missing');
    expect(check.fixCommand).toBe('slopsquatshield init --claude-code');
  });

  it('reports the Claude Code hook as ok once init --claude-code has written it', async () => {
    runInit(projectDir, { ...initBase(), claudeCode: true });
    const report = await runDoctor(projectDir, doctorOpts());

    expect(findCheck(report, 'Claude Code hook').status).toBe('ok');
  });

  it('finds a user-level hook even when the project has no .claude dir (an earlier doctor bug)', async () => {
    runInit(projectDir, { ...initBase(), claudeCode: true });
    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Claude Code hook');

    expect(check.status).toBe('ok');
    expect(check.detail).toContain('~/.claude/settings.json');
  });

  it('finds a project-level hook too', async () => {
    runInit(projectDir, { ...initBase(), claudeCode: true, project: true });
    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Claude Code hook');

    expect(check.status).toBe('ok');
    expect(check.detail).toContain('.claude/settings.json');
  });

  it('flags a legacy bare-name hook as outdated, with the fix command', async () => {
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

    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Claude Code hook');

    expect(check.status).toBe('outdated');
    expect(check.fixCommand).toBe('slopsquatshield init --claude-code');
  });

  it('reports an unparseable settings file instead of calling it missing', async () => {
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(claudeCodeSettingsPath(homeDir), '{ broken');

    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Claude Code hook');

    expect(check.status).toBe('unavailable');
    expect(check.detail).toContain('not valid JSON');
  });

  it('flags a missing Cursor hook with the exact fix command', async () => {
    mkdirSync(join(homeDir, '.cursor')); // Cursor is installed, just not hooked up yet
    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Cursor hook');

    expect(check.status).toBe('missing');
    expect(check.fixCommand).toBe('slopsquatshield init --cursor');
  });

  describe('only hosts that are actually installed are mentioned (#4)', () => {
    const surfaces = async () =>
      (await runDoctor(projectDir, doctorOpts())).checks.map((c) => c.surface);

    it('says nothing about Claude Code, Cursor, Codex or Antigravity on a machine with none of them', async () => {
      const names = await surfaces();

      for (const host of ['Claude Code hook', 'Cursor hook', 'Codex hook', 'Antigravity hook']) {
        expect(names).not.toContain(host);
      }
    });

    it('mentions Cursor, and only Cursor, once ~/.cursor exists', async () => {
      mkdirSync(join(homeDir, '.cursor'));
      const names = await surfaces();

      expect(names).toContain('Cursor hook');
      expect(names).not.toContain('Claude Code hook');
    });

    it('keeps reporting a host once our hook is in its config, even if the folder is gone', async () => {
      runInit(projectDir, { ...initBase(), cursor: true });
      expect(await surfaces()).toContain('Cursor hook');
    });
  });

  describe('run from the home directory (#7, #8)', () => {
    it('lists a user-level hook once, not as both "user" and "project" level', async () => {
      runInit(projectDir, { ...initBase(), claudeCode: true });

      const check = findCheck(await runDoctor(homeDir, doctorOpts()), 'Claude Code hook');

      expect(check.detail).toBe('Hook configured in ~/.claude/settings.json');
    });

    it('still lists both user-level and project-level when run from a project', async () => {
      runInit(projectDir, { ...initBase(), claudeCode: true });
      runInit(projectDir, { ...initBase(), claudeCode: true, project: true });

      const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Claude Code hook');

      expect(check.detail).toContain('~/.claude/settings.json');
      expect(check.detail).toContain('.claude/settings.json');
    });
  });

  it('reports the Cursor hook as ok once init --cursor has written it', async () => {
    runInit(projectDir, { ...initBase(), cursor: true });
    expect(findCheck(await runDoctor(projectDir, doctorOpts()), 'Cursor hook').status).toBe('ok');
  });

  it('flags the shell wrapper as missing, then ok, before/after init --shell', async () => {
    const before = await runDoctor(projectDir, doctorOpts());
    expect(findCheck(before, 'Shell wrapper (bash/zsh)').status).toBe('missing');
    expect(findCheck(before, 'Shell wrapper (bash/zsh)').fixCommand).toBe(
      'slopsquatshield init --shell',
    );

    runInit(projectDir, { ...initBase(), shell: true });
    const after = await runDoctor(projectDir, doctorOpts());
    expect(findCheck(after, 'Shell wrapper (bash/zsh)').status).toBe('ok');
    expect(findCheck(after, 'Shell wrapper (PowerShell)').status).toBe('ok');
  });

  describe('PowerShell profiles on Windows', () => {
    const winInit = () => ({ ...initBase(), platform: 'win32', shell: true });
    const winDoctor = () => ({ ...doctorOpts(), platform: 'win32' });

    it('is missing when only the PowerShell 7 profile has the wrapper, and names the 5.1 file', async () => {
      runInit(projectDir, winInit());
      const [, ps51] = powerShellProfiles({ home: homeDir, platform: 'win32' });
      rmSync(ps51.path);

      const check = findCheck(
        await runDoctor(projectDir, winDoctor()),
        'Shell wrapper (PowerShell)',
      );

      expect(check.status).toBe('missing');
      expect(check.detail).toContain('only');
      expect(check.fixCommand).toBe('slopsquatshield init --shell');
    });

    it('is ok once both profiles have it', async () => {
      runInit(projectDir, winInit());
      const check = findCheck(
        await runDoctor(projectDir, winDoctor()),
        'Shell wrapper (PowerShell)',
      );
      expect(check.status).toBe('ok');
      expect(check.detail).toContain('WindowsPowerShell');
    });

    it('looks in the Documents folder Windows reports', async () => {
      const redirected = join(homeDir, 'OneDrive', 'Documents');
      runInit(projectDir, { ...winInit(), detectDocumentsDir: () => redirected });

      const atHome = await runDoctor(projectDir, winDoctor());
      expect(findCheck(atHome, 'Shell wrapper (PowerShell)').status).toBe('missing');

      const atRedirect = await runDoctor(projectDir, {
        ...winDoctor(),
        detectDocumentsDir: () => redirected,
      });
      expect(findCheck(atRedirect, 'Shell wrapper (PowerShell)').status).toBe('ok');
    });
  });

  it('on Linux/macOS, leaves the PowerShell check out unless PowerShell is in use there', async () => {
    const without = await runDoctor(projectDir, doctorOpts());
    expect(without.checks.some((c) => c.surface === 'Shell wrapper (PowerShell)')).toBe(false);

    mkdirSync(join(homeDir, '.config', 'powershell'), { recursive: true });
    const withPwsh = await runDoctor(projectDir, doctorOpts());
    expect(findCheck(withPwsh, 'Shell wrapper (PowerShell)').status).toBe('missing');
  });

  it('flags a legacy bare-name shell wrapper as outdated', async () => {
    writeFileSync(
      bashProfilePath(homeDir),
      '# >>> slopsquatshield shell wrapper >>>\nnpm() { slopsquatshield npm "$@"; }\n# <<< slopsquatshield shell wrapper <<<\n',
    );

    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Shell wrapper (bash/zsh)');

    expect(check.status).toBe('outdated');
    expect(check.fixCommand).toBe('slopsquatshield init --shell');
  });

  describe('launcher', () => {
    it('is missing before init, ok after, and stale when recorded paths vanish', async () => {
      const missing = findCheck(await runDoctor(projectDir, doctorOpts()), 'Launcher');
      expect(missing.status).toBe('missing');

      runInit(projectDir, { ...initBase(), claudeCode: true });
      expect(findCheck(await runDoctor(projectDir, doctorOpts()), 'Launcher').status).toBe('ok');

      const stale = findCheck(
        await runDoctor(projectDir, { ...doctorOpts(), pathExists: () => false }),
        'Launcher',
      );
      expect(stale.status).toBe('outdated');
      expect(stale.fixCommand).toBe('slopsquatshield init');
    });
  });

  describe('live hook run', () => {
    it('runs the configured hook in a minimal env (only HOME + a system PATH) and passes on JSON', async () => {
      runInit(projectDir, { ...initBase(), claudeCode: true });
      const run = vi.fn(async () => ({ code: 0, stdout: '{"ok":true}', stderr: '' }));

      const report = await runDoctor(projectDir, { ...doctorOpts(), runHookCommand: run });

      expect(findCheck(report, 'Claude Code hook (live run)').status).toBe('ok');
      const [command, env, input] = run.mock.calls[0] as unknown as [
        string,
        Record<string, string>,
        string,
      ];
      expect(command).toBe('"$HOME/.config/slopsquatshield/bin/slopsquatshield" hook claude-code');
      expect(env).toEqual({ HOME: homeDir, PATH: '/usr/local/bin:/usr/bin:/bin' });
      expect(JSON.parse(input).tool_input.command).toBe('echo slopsquatshield-doctor');
    });

    it('fails with the stderr when the hook cannot run (the exit-127 case)', async () => {
      runInit(projectDir, { ...initBase(), claudeCode: true });
      const run = vi.fn(async () => ({
        code: 127,
        stdout: '',
        stderr: 'slopsquatshield: not found',
      }));

      const check = findCheck(
        await runDoctor(projectDir, { ...doctorOpts(), runHookCommand: run }),
        'Claude Code hook (live run)',
      );

      expect(check.status).toBe('unavailable');
      expect(check.detail).toContain('exit 127');
      expect(check.detail).toContain('not found');
      expect(check.fixCommand).toBe('slopsquatshield init --claude-code');
    });

    it('is skipped when no hook is configured, and on Windows', async () => {
      const none = await runDoctor(projectDir, doctorOpts());
      expect(none.checks.some((c) => c.surface === 'Claude Code hook (live run)')).toBe(false);

      runInit(projectDir, { ...initBase(), claudeCode: true });
      const win = await runDoctor(projectDir, { ...doctorOpts(), platform: 'win32' });
      expect(win.checks.some((c) => c.surface === 'Claude Code hook (live run)')).toBe(false);
    });
  });

  describe('install location', () => {
    it('adds no Install check for a persistent install', async () => {
      const report = await runDoctor(projectDir, doctorOpts());
      expect(report.checks.some((c) => c.surface === 'Install')).toBe(false);
    });

    it('flags an npx/dlx cache install with the global-install fix', async () => {
      const report = await runDoctor(projectDir, {
        ...doctorOpts(),
        selfLocation: { ...location, ephemeral: true },
      });
      const check = findCheck(report, 'Install');

      expect(check.status).toBe('unavailable');
      expect(check.fixCommand).toBe('npm install -g slopsquatshield');
    });
  });

  it('reports the cache as reachable', async () => {
    expect(findCheck(await runDoctor(projectDir, doctorOpts()), 'Cache').status).toBe('ok');
  });

  it('only checks the Java/Maven toolchain when a pom.xml is present', async () => {
    const withoutPom = await runDoctor(projectDir, doctorOpts());
    expect(withoutPom.checks.some((c) => c.surface === 'Java/Maven toolchain')).toBe(false);

    writeFileSync(join(projectDir, 'pom.xml'), '<project></project>');
    const withPom = await runDoctor(projectDir, doctorOpts());
    expect(withPom.checks.some((c) => c.surface === 'Java/Maven toolchain')).toBe(true);
  });

  describe('WSL detection', () => {
    it('never adds a WSL check when no distro is detected', async () => {
      const report = await runDoctor(projectDir, doctorOpts());
      expect(report.checks.some((c) => c.surface === 'Shell wrapper (WSL bash/zsh)')).toBe(false);
    });

    it('flags the WSL shell wrapper as missing, then ok, before/after init --shell', async () => {
      const wslHomeDir = mkdtempSync(join(tmpdir(), 'ssg-doctor-wsl-home-'));
      try {
        const detectWslHome = () => ({
          distro: 'Ubuntu',
          posixPath: '/home/user',
          windowsPath: wslHomeDir,
        });

        const before = await runDoctor(projectDir, { ...doctorOpts(), detectWslHome });
        const beforeCheck = findCheck(before, 'Shell wrapper (WSL bash/zsh)');
        expect(beforeCheck.status).toBe('missing');
        expect(beforeCheck.fixCommand).toBe('slopsquatshield init --shell');

        runInit(projectDir, { ...initBase(), shell: true, detectWslHome, chmodWsl: () => {} });
        const after = await runDoctor(projectDir, { ...doctorOpts(), detectWslHome });
        expect(findCheck(after, 'Shell wrapper (WSL bash/zsh)').status).toBe('ok');
      } finally {
        rmSync(wslHomeDir, { recursive: true, force: true });
      }
    });

    it("also finds a hook in the WSL distro's own ~/.claude", async () => {
      const wslHomeDir = mkdtempSync(join(tmpdir(), 'ssg-doctor-wsl-home-'));
      try {
        const detectWslHome = () => ({
          distro: 'Ubuntu',
          posixPath: '/home/user',
          windowsPath: wslHomeDir,
        });
        runInit(projectDir, { ...initBase(), claudeCode: true, detectWslHome, chmodWsl: () => {} });

        const check = findCheck(
          await runDoctor(projectDir, { ...doctorOpts(), detectWslHome }),
          'Claude Code hook',
        );
        expect(check.detail).toContain("Ubuntu's ~/.claude/settings.json");
      } finally {
        rmSync(wslHomeDir, { recursive: true, force: true });
      }
    });
  });
});

describe('runDoctor — Codex and Antigravity', () => {
  it('omits the Codex and Antigravity checks when neither host looks installed', async () => {
    const report = await runDoctor(projectDir, doctorOpts());
    expect(report.checks.some((c) => c.surface === 'Codex hook')).toBe(false);
    expect(report.checks.some((c) => c.surface === 'Antigravity hook')).toBe(false);
  });

  it('reports a missing Codex hook, with the fix, once ~/.codex exists', async () => {
    mkdirSync(join(homeDir, '.codex'));
    const check = findCheck(await runDoctor(projectDir, doctorOpts()), 'Codex hook');
    expect(check.status).toBe('missing');
    expect(check.fixCommand).toBe('slopsquatshield init --codex');
  });

  it('reports Antigravity as missing once ~/.gemini exists, then ok after init', async () => {
    mkdirSync(join(homeDir, '.gemini'));
    const before = findCheck(await runDoctor(projectDir, doctorOpts()), 'Antigravity hook');
    expect(before.status).toBe('missing');
    expect(before.fixCommand).toBe('slopsquatshield init --antigravity');

    runInit(projectDir, { ...initBase(), antigravity: true });
    const after = findCheck(await runDoctor(projectDir, doctorOpts()), 'Antigravity hook');
    expect(after.status).toBe('ok');
  });

  it('runs a live check per configured host with that host’s own payload and contract', async () => {
    runInit(projectDir, { ...initBase(), claudeCode: true, codex: true, antigravity: true });
    const calls: Array<{ command: string; input: string }> = [];
    const run = vi.fn(async (command: string, _env: NodeJS.ProcessEnv, input: string) => {
      calls.push({ command, input });
      // "allow" is exit 0 with no output for Claude Code, Codex and Antigravity (an explicit
      // allow would skip the user's own approval); Cursor must answer in JSON.
      return { code: 0, stdout: command.includes('hook cursor') ? '{"ok":true}' : '', stderr: '' };
    });

    const report = await runDoctor(projectDir, { ...doctorOpts(), runHookCommand: run });

    for (const surface of [
      'Claude Code hook (live run)',
      'Codex hook (live run)',
      'Antigravity hook (live run)',
    ]) {
      expect(findCheck(report, surface).status).toBe('ok');
    }
    const agy = calls.find((c) => c.command.includes('hook antigravity'));
    expect(JSON.parse(agy?.input ?? '{}').toolCall.args.CommandLine).toBe(
      'echo slopsquatshield-doctor',
    );
  });

  it('an empty answer is fine for Claude Code, Codex and Antigravity, but not for Cursor', async () => {
    mkdirSync(join(homeDir, '.cursor'));
    runInit(projectDir, {
      ...initBase(),
      claudeCode: true,
      codex: true,
      antigravity: true,
      cursor: true,
    });
    const silent = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));

    const report = await runDoctor(projectDir, { ...doctorOpts(), runHookCommand: silent });

    expect(findCheck(report, 'Claude Code hook (live run)').status).toBe('ok');
    expect(findCheck(report, 'Codex hook (live run)').status).toBe('ok');
    expect(findCheck(report, 'Antigravity hook (live run)').status).toBe('ok');
    expect(findCheck(report, 'Cursor hook (live run)').status).toBe('unavailable');
  });
});
