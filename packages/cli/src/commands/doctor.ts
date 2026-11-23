// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RegistryCache, defaultCacheDbPath, findOnPath } from '@slopsquatshield/core';
import { discoverManifests } from '../discover-manifests.js';
import { antigravityHookState } from '../hooks/antigravity-config.js';
import { type HookState, claudeCodeHookState } from '../hooks/claude-code-config.js';
import { codexHookState } from '../hooks/codex-config.js';
import { cursorHookState } from '../hooks/cursor-config.js';
import { gitHookState, gitHooksDir } from '../hooks/git-hook.js';
import {
  antigravityHookCommand,
  claudeCodeHookCommand,
  codexHookCommand,
  cursorHookCommand,
  wslHookCommand,
} from '../hooks/hook-command.js';
import { inspectLauncher } from '../install/launcher.js';
import { type SelfLocation, detectSelfLocation } from '../install/self-location.js';
import { detectDocumentsDir } from '../shell/documents-dir.js';
import { bashProfilePath, powerShellProfiles, zshProfilePath } from '../shell/profile-paths.js';
import { buildBashZshSnippet, buildPowerShellSnippet, snippetState } from '../shell/snippet.js';
import { type WslHome, detectWslHome } from '../shell/wsl.js';

/** `outdated`: configured, but in a legacy form that needs `init` re-run (e.g. a bare PATH-dependent command). */
export type DoctorStatus = 'ok' | 'missing' | 'outdated' | 'unavailable';

export interface DoctorCheck {
  surface: string;
  status: DoctorStatus;
  detail: string;
  fixCommand?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
}

function checkAllowlist(cwd: string): DoctorCheck {
  const path = join(cwd, '.slopsquatshield');
  return existsSync(path)
    ? { surface: 'Allowlist', status: 'ok', detail: `.slopsquatshield found at ${path}` }
    : {
        surface: 'Allowlist',
        status: 'missing',
        detail: 'No .slopsquatshield allowlist file found',
        fixCommand: 'slopsquatshield init',
      };
}

function checkCache(cachePath: string | undefined): DoctorCheck {
  try {
    const cache = new RegistryCache(cachePath);
    cache.close();
    return {
      surface: 'Cache',
      status: 'ok',
      detail: `Reachable at ${cachePath ?? defaultCacheDbPath()}`,
    };
  } catch (err) {
    return {
      surface: 'Cache',
      status: 'unavailable',
      detail: `Could not open local cache: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkGitHook(cwd: string): DoctorCheck {
  const hooksDir = gitHooksDir(cwd);
  const state = hooksDir ? gitHookState(join(hooksDir, 'pre-commit')) : 'absent';
  const fixCommand = 'slopsquatshield init --git-hook';
  if (state === 'current') {
    return {
      surface: 'Git pre-commit hook',
      status: 'ok',
      detail: 'Installed (advisory: only a BLOCK fails a commit)',
    };
  }
  if (state === 'outdated') {
    return {
      surface: 'Git pre-commit hook',
      status: 'outdated',
      detail: 'Installed in an older form — re-run init to upgrade it',
      fixCommand,
    };
  }
  return {
    surface: 'Git pre-commit hook',
    status: 'missing',
    detail: 'Not installed in this repository (optional; or use the pre-commit framework)',
    fixCommand,
  };
}

/** Only added when running from an npx/dlx cache — `init` refuses there, so say why up front. */
function checkEphemeralInstall(location: SelfLocation): DoctorCheck {
  return {
    surface: 'Install',
    status: 'unavailable',
    detail: `Running from a temporary npx/dlx cache (${location.entryPath}) — a launcher pointing here would break when the cache is pruned`,
    fixCommand: 'npm install -g slopsquatshield',
  };
}

function checkLauncher(home: string, exists: ((p: string) => boolean) | undefined): DoctorCheck {
  const info = inspectLauncher(home, exists);
  if (info.state === 'ok') {
    return {
      surface: 'Launcher',
      status: 'ok',
      detail: `Runs ${info.nodePath} ${info.entryPath}`,
    };
  }
  if (info.state === 'stale') {
    return {
      surface: 'Launcher',
      status: 'outdated',
      detail: `Recorded Node/CLI path no longer exists${info.entryPath ? ` (${info.entryPath})` : ''}`,
      fixCommand: 'slopsquatshield init',
    };
  }
  return {
    surface: 'Launcher',
    status: 'missing',
    detail:
      'No launcher at ~/.config/slopsquatshield/bin — hooks and wrappers have nothing stable to call',
    fixCommand: 'slopsquatshield init --shell --claude-code',
  };
}

function wrapperCheck(
  surface: string,
  states: Array<{ label: string; state: ReturnType<typeof snippetState> }>,
): DoctorCheck {
  const fixCommand = 'slopsquatshield init --shell';
  if (states.every((s) => s.state === 'current')) {
    return {
      surface,
      status: 'ok',
      detail: `Installed in ${states.map((s) => s.label).join(' and ')}`,
    };
  }
  if (states.some((s) => s.state === 'outdated')) {
    const stale = states.filter((s) => s.state === 'outdated').map((s) => s.label);
    return {
      surface,
      status: 'outdated',
      detail: `Legacy wrapper in ${stale.join(' and ')} (depends on PATH) — re-run init to upgrade`,
      fixCommand,
    };
  }
  const present = states.filter((s) => s.state === 'current').map((s) => s.label);
  return {
    surface,
    status: 'missing',
    detail: present.length
      ? `Installed in ${present.join(' and ')} only`
      : `Not installed in ${states.map((s) => s.label).join(' or ')}`,
    fixCommand,
  };
}

function checkBashZshWrapper(home: string): DoctorCheck {
  const snippet = buildBashZshSnippet();
  return wrapperCheck('Shell wrapper (bash/zsh)', [
    { label: bashProfilePath(home), state: snippetState(bashProfilePath(home), snippet) },
    { label: zshProfilePath(home), state: snippetState(zshProfilePath(home), snippet) },
  ]);
}

function checkPowerShellWrapper(
  home: string,
  platform: string,
  documentsDir: string | undefined,
): DoctorCheck {
  const snippet = buildPowerShellSnippet(platform);
  return wrapperCheck(
    'Shell wrapper (PowerShell)',
    powerShellProfiles({ home, platform, documentsDir }).map(({ path }) => ({
      label: path,
      state: snippetState(path, snippet),
    })),
  );
}

/** Only meaningful (and only called) when `detectWslHome()` found a distro. */
function checkWslWrapper(wslHome: WslHome): DoctorCheck {
  const snippet = buildBashZshSnippet();
  return wrapperCheck('Shell wrapper (WSL bash/zsh)', [
    {
      label: `${wslHome.distro}'s ~/.bashrc`,
      state: snippetState(bashProfilePath(wslHome.windowsPath), snippet),
    },
    {
      label: `${wslHome.distro}'s ~/.zshrc`,
      state: snippetState(zshProfilePath(wslHome.windowsPath), snippet),
    },
  ]);
}

interface HookLocation {
  label: string;
  state: HookState;
}

/**
 * Aggregates a hook's state across every place it can live (user-level, project-level, WSL
 * home) — an earlier bug was `doctor` reporting MISSING for a hook that existed in
 * `~/.claude/settings.json` because only `<cwd>/.claude` was ever consulted.
 */
function hookCheck(surface: string, fixCommand: string, locations: HookLocation[]): DoctorCheck {
  const current = locations.filter((l) => l.state === 'current');
  const outdated = locations.filter((l) => l.state === 'outdated');
  const invalid = locations.filter((l) => l.state === 'invalid-json');

  if (current.length > 0 && outdated.length === 0) {
    return {
      surface,
      status: 'ok',
      detail: `Hook configured in ${current.map((l) => l.label).join(', ')}`,
    };
  }
  if (outdated.length > 0) {
    return {
      surface,
      status: 'outdated',
      detail: `Legacy hook command in ${outdated.map((l) => l.label).join(', ')} (depends on PATH, can exit 127) — re-run init to upgrade`,
      fixCommand,
    };
  }
  if (invalid.length > 0) {
    return {
      surface,
      status: 'unavailable',
      detail: `${invalid.map((l) => l.label).join(', ')} is not valid JSON — fix it by hand, init will not overwrite it`,
    };
  }
  return {
    surface,
    status: 'missing',
    detail: `No hook found in ${locations.map((l) => l.label).join(', ')}`,
    fixCommand,
  };
}

export interface LiveHookResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a hook command string through `sh -c` in a deliberately minimal environment. */
async function defaultRunHookCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  input: string,
): Promise<LiveHookResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'sh',
      ['-c', command],
      { env, timeout: 15_000 },
      (err, stdout, stderr) => {
        const code: unknown = err ? (err as { code?: unknown }).code : 0;
        resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
      },
    );
    child.stdin?.end(input);
  });
}

interface LiveHookSpec {
  surface: string;
  command: string;
  /** The stdin payload this host's PreToolUse sends, for a harmless non-install command. */
  payload: string;
  /**
   * Claude Code, Codex and Antigravity answer "allow" with exit 0 and no output (an explicit
   * "allow" would skip the user's own approval prompt); Cursor must answer in JSON.
   */
  emptyStdoutOk: boolean;
  fixCommand: string;
}

const CLAUDE_STYLE_PAYLOAD = JSON.stringify({
  tool_name: 'Bash',
  tool_input: { command: 'echo slopsquatshield-doctor' },
});
/** Cursor's own `beforeShellExecution` payload: the command is top-level, not under tool_input. */
const CURSOR_PAYLOAD = JSON.stringify({
  hook_event_name: 'beforeShellExecution',
  command: 'echo slopsquatshield-doctor',
  cwd: '/',
  workspace_roots: ['/'],
});
const ANTIGRAVITY_PAYLOAD = JSON.stringify({
  toolCall: { name: 'run_command', args: { CommandLine: 'echo slopsquatshield-doctor' } },
});

/**
 * The check that would have caught the nvm exit-127 hook failure: actually runs the configured
 * hook command the way a host does — non-interactive `sh`, only `HOME` and a system-default
 * PATH, no nvm — with a harmless non-install payload, and expects the host's own "allow"
 * answer. POSIX only (hosts on Windows use a different shell).
 */
async function liveHookCheck(
  spec: LiveHookSpec,
  home: string,
  run: (command: string, env: NodeJS.ProcessEnv, input: string) => Promise<LiveHookResult>,
): Promise<DoctorCheck> {
  const env = { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin' };
  const result = await run(spec.command, env, spec.payload);
  let answered = spec.emptyStdoutOk && result.stdout.trim() === '';
  try {
    JSON.parse(result.stdout);
    answered = true;
  } catch {
    // not JSON — `answered` keeps whatever the empty-stdout rule decided
  }
  if (result.code === 0 && answered) {
    return {
      surface: spec.surface,
      status: 'ok',
      detail: 'Hook command runs from a minimal, non-interactive environment',
    };
  }
  return {
    surface: spec.surface,
    status: 'unavailable',
    detail: `Hook command failed from a minimal environment (exit ${result.code}): ${result.stderr.trim() || 'no output'}`,
    fixCommand: spec.fixCommand,
  };
}

async function checkJavaToolchain(): Promise<DoctorCheck> {
  try {
    // Only looked up on PATH, never run: Maven reads `.mvn/jvm.config` from the project around its
    // working directory (even for `--version`), so running it inside a cloned repository would let
    // that repository run code — and a bare name may resolve to a binary in the current directory
    // on Windows.
    if (!findOnPath('mvn') || !findOnPath('java')) throw new Error('not on PATH');
    return {
      surface: 'Java/Maven toolchain',
      status: 'ok',
      detail: 'java and mvn both found on PATH',
    };
  } catch {
    return {
      surface: 'Java/Maven toolchain',
      status: 'missing',
      detail: 'java and/or mvn not found on PATH — needed only for `scan --maven-tree`',
      fixCommand:
        'install a JDK and Apache Maven so `java` and `mvn` are on PATH, then open a new terminal',
    };
  }
}

/**
 * FR-10.3: reports per-surface config state with the exact fix command for any gap.
 * Java/Maven toolchain is only checked when a `pom.xml` is actually present — it's
 * irrelevant noise for a pure npm/PyPI project.
 */
export async function runDoctor(
  cwd: string,
  options: {
    home?: string;
    cachePath?: string;
    detectWslHome?: () => WslHome | undefined;
    /** Override for asking Windows where Documents is — mainly for tests (never spawn powershell.exe). */
    detectDocumentsDir?: () => string | undefined;
    platform?: string;
    /** Override for the live hook run — mainly for tests; never spawn a real hook in a test. */
    runHookCommand?: (
      command: string,
      env: NodeJS.ProcessEnv,
      input: string,
    ) => Promise<LiveHookResult>;
    /** Override for the running CLI's location — mainly for tests; defaults to `detectSelfLocation()`. */
    selfLocation?: SelfLocation;
    /** Override for path-existence checks on the launcher's recorded paths — mainly for tests. */
    pathExists?: (path: string) => boolean;
  } = {},
): Promise<DoctorReport> {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  // Run from the home directory, `cwd` and `~` are the same place: don't walk the whole home
  // looking for manifests, and don't list the same config file twice as "user" and "project" level.
  const inHome = resolve(cwd) === resolve(home);
  const manifests = inHome ? undefined : discoverManifests(cwd);
  const wslHome = (options.detectWslHome ?? detectWslHome)();

  const projectLevel = (location: HookLocation): HookLocation[] => (inHome ? [] : [location]);
  const claudeLocations: HookLocation[] = [
    { label: '~/.claude/settings.json', state: claudeCodeHookState(home) },
    ...projectLevel({ label: '.claude/settings.json', state: claudeCodeHookState(cwd) }),
  ];
  const cursorLocations: HookLocation[] = [
    { label: '~/.cursor/hooks.json', state: cursorHookState(home, home, platform) },
    ...projectLevel({ label: '.cursor/hooks.json', state: cursorHookState(cwd, home, platform) }),
  ];
  const codexLocations: HookLocation[] = [
    { label: '~/.codex/hooks.json', state: codexHookState(home, home, platform) },
    ...projectLevel({ label: '.codex/hooks.json', state: codexHookState(cwd, home, platform) }),
  ];
  const antigravityLocations: HookLocation[] = [
    {
      label: '~/.gemini/config/hooks.json',
      state: antigravityHookState(home, 'user', home, platform),
    },
    ...projectLevel({
      label: '.agents/hooks.json',
      state: antigravityHookState(cwd, 'project', home, platform),
    }),
  ];
  if (wslHome) {
    claudeLocations.push({
      label: `${wslHome.distro}'s ~/.claude/settings.json`,
      state: claudeCodeHookState(wslHome.windowsPath),
    });
    codexLocations.push({
      label: `${wslHome.distro}'s ~/.codex/hooks.json`,
      state: codexHookState(
        wslHome.windowsPath,
        undefined,
        undefined,
        wslHookCommand('codex', wslHome.posixPath),
      ),
    });
  }

  const claudeCheck = hookCheck(
    'Claude Code hook',
    'slopsquatshield init --claude-code',
    claudeLocations,
  );
  const cursorCheck = hookCheck('Cursor hook', 'slopsquatshield init --cursor', cursorLocations);
  const codexCheck = hookCheck('Codex hook', 'slopsquatshield init --codex', codexLocations);
  const antigravityCheck = hookCheck(
    'Antigravity hook',
    'slopsquatshield init --antigravity',
    antigravityLocations,
  );

  // A host is reported only when it looks installed (its config dir exists) or one of our hooks is
  // already present — otherwise a user who doesn't run it would see a permanent, unfixable-by-intent
  // MISSING (and be told to configure an editor they don't have).
  const hostPresent = (...paths: string[]) => paths.some((p) => existsSync(p));
  const claudeRelevant =
    claudeCheck.status !== 'missing' || hostPresent(join(home, '.claude'), join(cwd, '.claude'));
  const cursorRelevant =
    cursorCheck.status !== 'missing' || hostPresent(join(home, '.cursor'), join(cwd, '.cursor'));
  const codexRelevant =
    codexCheck.status !== 'missing' || hostPresent(join(home, '.codex'), join(cwd, '.codex'));
  const antigravityRelevant =
    antigravityCheck.status !== 'missing' ||
    hostPresent(join(home, '.gemini'), join(cwd, '.agents'));

  // PowerShell is always there on Windows. Elsewhere, report it only where it is in use (its config
  // dir exists) or our wrapper is already in a profile — not as a MISSING on every Linux/macOS box.
  const powerShellCheck = checkPowerShellWrapper(
    home,
    platform,
    platform === 'win32' ? (options.detectDocumentsDir ?? detectDocumentsDir)() : undefined,
  );
  const powerShellRelevant =
    platform === 'win32' ||
    powerShellCheck.status !== 'missing' ||
    hostPresent(join(home, '.config', 'powershell'));

  const location = options.selfLocation ?? detectSelfLocation();
  const checks: DoctorCheck[] = [
    checkAllowlist(cwd),
    checkCache(options.cachePath),
    ...(location.ephemeral ? [checkEphemeralInstall(location)] : []),
    checkLauncher(home, options.pathExists),
    checkBashZshWrapper(home),
    ...(powerShellRelevant ? [powerShellCheck] : []),
    ...(claudeRelevant ? [claudeCheck] : []),
    ...(cursorRelevant ? [cursorCheck] : []),
    ...(codexRelevant ? [codexCheck] : []),
    ...(antigravityRelevant ? [antigravityCheck] : []),
  ];

  if (wslHome) {
    checks.push(checkWslWrapper(wslHome));
  }

  // Only meaningful inside a git repo: report the advisory pre-commit hook (FR-20.4).
  if (existsSync(join(cwd, '.git'))) checks.push(checkGitHook(cwd));

  if (platform !== 'win32') {
    const run = options.runHookCommand ?? defaultRunHookCommand;
    const live: Array<[DoctorCheck, LiveHookSpec]> = [
      [
        claudeCheck,
        {
          surface: 'Claude Code hook (live run)',
          command: claudeCodeHookCommand(),
          payload: CLAUDE_STYLE_PAYLOAD,
          emptyStdoutOk: true,
          fixCommand: 'slopsquatshield init --claude-code',
        },
      ],
      [
        cursorCheck,
        {
          surface: 'Cursor hook (live run)',
          command: cursorHookCommand(home, platform),
          payload: CURSOR_PAYLOAD,
          emptyStdoutOk: false,
          fixCommand: 'slopsquatshield init --cursor',
        },
      ],
      [
        codexCheck,
        {
          surface: 'Codex hook (live run)',
          command: codexHookCommand(home, platform),
          payload: CLAUDE_STYLE_PAYLOAD,
          emptyStdoutOk: true,
          fixCommand: 'slopsquatshield init --codex',
        },
      ],
      [
        antigravityCheck,
        {
          surface: 'Antigravity hook (live run)',
          command: antigravityHookCommand(home, platform),
          payload: ANTIGRAVITY_PAYLOAD,
          emptyStdoutOk: true,
          fixCommand: 'slopsquatshield init --antigravity',
        },
      ],
    ];
    for (const [check, spec] of live) {
      if (check.status === 'ok') checks.push(await liveHookCheck(spec, home, run));
    }
  }

  if (manifests && manifests.pomXml.length > 0) {
    checks.push(await checkJavaToolchain());
  }
  return { checks };
}
