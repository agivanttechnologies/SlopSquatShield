// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Ecosystem } from '@slopsquatshield/core';
import { discoverManifests } from '../discover-manifests.js';
import { writeAntigravityHookConfig } from '../hooks/antigravity-config.js';
import { type HookWriteResult, writeClaudeCodeHookConfig } from '../hooks/claude-code-config.js';
import { writeCodexHookConfig } from '../hooks/codex-config.js';
import { writeCursorHookConfig } from '../hooks/cursor-config.js';
import { type GitHookResult, gitHooksDir, installGitHook } from '../hooks/git-hook.js';
import { wslHookCommand } from '../hooks/hook-command.js';
import { writeLauncher, writeWslLauncher } from '../install/launcher.js';
import { type SelfLocation, detectSelfLocation } from '../install/self-location.js';
import { createCiShims } from '../shell/ci-shim.js';
import { detectDocumentsDir } from '../shell/documents-dir.js';
import { bashProfilePath, powerShellProfiles, zshProfilePath } from '../shell/profile-paths.js';
import {
  type SnippetInstallResult,
  buildBashZshSnippet,
  buildPowerShellSnippet,
  installSnippetToFile,
} from '../shell/snippet.js';
import { type WslHome, detectWslHome } from '../shell/wsl.js';

const ALLOWLIST_TEMPLATE =
  '# One identifier per line — a bare package name, or groupId:artifactId for Maven.\n' +
  '# Lines starting with # are comments.\n';

export interface InitOptions {
  shell?: boolean;
  claudeCode?: boolean;
  cursor?: boolean;
  codex?: boolean;
  antigravity?: boolean;
  /** Install `.git/hooks/pre-commit` in this repo (FR-20.4). Explicit only — never part of `--all`. */
  gitHook?: boolean;
  /**
   * FR-14.1: the shell wrapper plus a hook for every agent host whose config dir is found
   * (`~/.claude`, `~/.cursor`, `~/.codex`, `~/.gemini`, or the project's `.claude`/`.cursor`/
   * `.codex`/`.agents`). Explicit per-host flags still force a write for hosts not found.
   */
  all?: boolean;
  ci?: boolean;
  ciShimDir?: string;
  /** Write hook configs into `<cwd>/.claude|.cursor` instead of the user-level files (default). */
  project?: boolean;
  /** Override for the home directory (profiles, launcher, user-level hooks) — mainly for tests. */
  home?: string;
  /** Override for the running CLI's location — mainly for tests; defaults to `detectSelfLocation()`. */
  selfLocation?: SelfLocation;
  /** Override for the platform — mainly for tests. */
  platform?: string;
  /** Override for making the WSL launcher executable — mainly for tests (never spawn wsl.exe). */
  chmodWsl?: (distro: string, posixPath: string) => void;
  /** Override for WSL detection — mainly for tests, so they never spawn a real wsl.exe. */
  detectWslHome?: () => WslHome | undefined;
  /** Override for asking Windows where Documents is — mainly for tests, so they never spawn powershell.exe. */
  detectDocumentsDir?: () => string | undefined;
}

export interface InitResult {
  detectedEcosystems: Ecosystem[];
  allowlist: 'created' | 'already-existed';
  /**
   * The stable launcher every surface calls (`install/launcher.ts`). `refused-ephemeral`:
   * running from an npx/dlx cache, where a recorded path would break — nothing that needs the
   * launcher is configured, and the message says how to install properly.
   */
  launcher?: { status: 'written'; path: string } | { status: 'refused-ephemeral'; message: string };
  shell?: {
    bash: SnippetInstallResult;
    zsh: SnippetInstallResult;
    /** One entry per PowerShell profile written: two on Windows (7+ and 5.1), one elsewhere. */
    powershell: Array<{ label: string; path: string; result: SnippetInstallResult }>;
    /** Only present when a WSL distro was detected — see shell/wsl.ts. */
    wsl?: { distro: string; bash: SnippetInstallResult; zsh: SnippetInstallResult };
  };
  /** Which hosts `--all` found a config dir for (empty unless `--all` was used). */
  detectedHosts?: string[];
  claudeCodeHook?: HookWriteResult;
  /** Also written when a WSL distro was detected and hooks are user-level. */
  claudeCodeHookWsl?: HookWriteResult;
  cursorHook?: HookWriteResult;
  codexHook?: HookWriteResult;
  /** Also written when a WSL distro was detected and hooks are user-level. */
  codexHookWsl?: HookWriteResult;
  antigravityHook?: HookWriteResult;
  /** Where the pre-commit hook went, or why it wasn't written (FR-20.4). */
  gitHook?: { result: GitHookResult; path?: string };
  ciShims?: string[];
}

function detectEcosystems(cwd: string, home: string): Ecosystem[] {
  // From the home directory this would walk every project under `~` and report their ecosystems as
  // if they were this one's. There is no "project" there to describe.
  if (resolve(cwd) === resolve(home)) return [];
  const manifests = discoverManifests(cwd);
  const ecosystems: Ecosystem[] = [];
  if (manifests.packageJson.length > 0) ecosystems.push('npm');
  if (
    manifests.requirementsTxt.length + manifests.pyprojectToml.length + manifests.pipfile.length >
    0
  ) {
    ecosystems.push('pypi');
  }
  if (manifests.pomXml.length > 0) ecosystems.push('maven');
  return ecosystems;
}

function ensureAllowlist(cwd: string): 'created' | 'already-existed' {
  const path = join(cwd, '.slopsquatshield');
  if (existsSync(path)) return 'already-existed';
  writeFileSync(path, ALLOWLIST_TEMPLATE);
  return 'created';
}

/**
 * FR-10.1/10.2: detects project type and configures every requested surface in one run,
 * idempotently — every sub-step here (allowlist creation, shell-snippet install, hook
 * config write) already guards against re-running by checking for its own prior work
 * first, so calling this twice with the same options is always a no-op the second time.
 */
/** Config dirs that mean "this agent host is installed" — checked under home and the project. */
const HOST_DIRS = {
  claudeCode: '.claude',
  cursor: '.cursor',
  codex: '.codex',
  antigravity: '.gemini',
} as const;
const ANTIGRAVITY_PROJECT_DIR = '.agents';

function detectHosts(home: string, cwd: string): Record<keyof typeof HOST_DIRS, boolean> {
  const found = (name: string, ...roots: string[]) => roots.some((r) => existsSync(join(r, name)));
  return {
    claudeCode: found(HOST_DIRS.claudeCode, home, cwd),
    cursor: found(HOST_DIRS.cursor, home, cwd),
    codex: found(HOST_DIRS.codex, home, cwd),
    antigravity: found(HOST_DIRS.antigravity, home) || found(ANTIGRAVITY_PROJECT_DIR, cwd),
  };
}

export function runInit(cwd: string, options: InitOptions = {}): InitResult {
  const home = options.home ?? homedir();
  const result: InitResult = {
    detectedEcosystems: detectEcosystems(cwd, home),
    allowlist: ensureAllowlist(cwd),
  };

  const platform = options.platform ?? process.platform;

  // --all (FR-14.1): shell + every host whose config dir exists; explicit flags force more.
  const detected = options.all ? detectHosts(home, cwd) : undefined;
  if (detected) {
    result.detectedHosts = Object.entries(detected)
      .filter(([, found]) => found)
      .map(([host]) => host);
  }
  const want = {
    shell: options.shell || options.all,
    claudeCode: options.claudeCode || detected?.claudeCode,
    cursor: options.cursor || detected?.cursor,
    codex: options.codex || detected?.codex,
    antigravity: options.antigravity || detected?.antigravity,
  };

  const needsLauncher =
    want.shell ||
    want.claudeCode ||
    want.cursor ||
    want.codex ||
    want.antigravity ||
    options.ci ||
    options.gitHook;
  if (!needsLauncher) return result;

  const location = options.selfLocation ?? detectSelfLocation();

  if (location.ephemeral) {
    result.launcher = {
      status: 'refused-ephemeral',
      message:
        'slopsquatshield is running from a temporary npx/dlx cache, so a launcher pointing at it would break when the cache is pruned. Install it properly (npm install -g slopsquatshield) and re-run init.',
    };
    return result;
  }

  result.launcher = { status: 'written', path: writeLauncher({ home, platform, location }) };

  const wslHome =
    want.shell || want.claudeCode || want.codex
      ? (options.detectWslHome ?? detectWslHome)()
      : undefined;
  if (wslHome) {
    writeWslLauncher({
      distro: wslHome.distro,
      windowsHome: wslHome.windowsPath,
      posixHome: wslHome.posixPath,
      location,
      chmodExecutable: options.chmodWsl,
    });
  }

  if (want.shell) {
    result.shell = {
      bash: installSnippetToFile(bashProfilePath(home), buildBashZshSnippet()),
      zsh: installSnippetToFile(zshProfilePath(home), buildBashZshSnippet()),
      powershell: powerShellProfiles({
        home,
        platform,
        documentsDir: (options.detectDocumentsDir ?? detectDocumentsDir)(),
      }).map(({ label, path }) => ({
        label,
        path,
        result: installSnippetToFile(path, buildPowerShellSnippet(platform)),
      })),
    };
    if (wslHome) {
      result.shell.wsl = {
        distro: wslHome.distro,
        bash: installSnippetToFile(bashProfilePath(wslHome.windowsPath), buildBashZshSnippet()),
        zsh: installSnippetToFile(zshProfilePath(wslHome.windowsPath), buildBashZshSnippet()),
      };
    }
  }

  const hookRoot = options.project ? cwd : home;
  const userScope = !options.project;

  if (want.claudeCode) {
    result.claudeCodeHook = writeClaudeCodeHookConfig(hookRoot);
    if (wslHome && userScope) {
      // Claude Code running *inside* WSL reads the distro's own ~/.claude, not the Windows one.
      result.claudeCodeHookWsl = writeClaudeCodeHookConfig(wslHome.windowsPath);
    }
  }

  if (want.cursor) {
    result.cursorHook = writeCursorHookConfig(hookRoot, home, platform);
  }

  if (want.codex) {
    result.codexHook = writeCodexHookConfig(hookRoot, home, platform);
    if (wslHome && userScope) {
      // Codex running inside WSL reads the distro's own ~/.codex; its launcher is the WSL one.
      result.codexHookWsl = writeCodexHookConfig(
        wslHome.windowsPath,
        undefined,
        undefined,
        wslHookCommand('codex', wslHome.posixPath),
      );
    }
  }

  if (want.antigravity) {
    result.antigravityHook = writeAntigravityHookConfig(
      hookRoot,
      userScope ? 'user' : 'project',
      home,
      platform,
    );
  }

  if (options.gitHook) {
    const hooksDir = gitHooksDir(cwd);
    result.gitHook = hooksDir
      ? { result: installGitHook(join(hooksDir, 'pre-commit')), path: join(hooksDir, 'pre-commit') }
      : { result: 'not-a-repo' };
  }

  if (options.ci) {
    result.ciShims = createCiShims({ shimDir: options.ciShimDir, home, platform });
  }

  return result;
}
