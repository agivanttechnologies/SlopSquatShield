// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { homedir } from 'node:os';
import { CREDIT, type HookCheckResult, setUserAgent } from '@slopsquatshield/core';
import { Command } from 'commander';
import { runAllow } from './commands/allow.js';
import { runDoctor } from './commands/doctor.js';
import { runInit } from './commands/init.js';
import { type InstallTool, runInstallWrapper } from './commands/install-wrapper.js';
import { listStagedFiles, runPrecommit } from './commands/precommit.js';
import { runScan } from './commands/scan.js';
import { runUninstall } from './commands/uninstall.js';
import { formatDoctorReport } from './format/doctor.js';
import { formatInitResult } from './format/init.js';
import { formatScanJson } from './format/json.js';
import { formatScanReport } from './format/scan.js';
import { formatUninstallResult } from './format/uninstall.js';
import { formatAntigravityHookOutput } from './hooks/antigravity.js';
import { formatClaudeCodeHookOutput } from './hooks/claude-code.js';
import { formatCodexHookOutput } from './hooks/codex.js';
import { formatCursorHookOutput } from './hooks/cursor.js';
import type { HookHost } from './hooks/hook-command.js';
import { runHookCheckFromStdin } from './hooks/hook-runner.js';
import { refreshLauncherIfStale } from './install/launcher.js';
import { detectSelfLocation } from './install/self-location.js';

/** Injected at build time by tsup from package.json (see tsup.config.ts); absent under Vitest. */
declare const __SSG_VERSION__: string | undefined;

// Commands: scan, the npm/pip/mvn safe-install wrapper, init/doctor/uninstall, allow, precommit,
// and the agent hooks (Claude Code, Cursor, Codex, Antigravity).
const program = new Command();
const VERSION = typeof __SSG_VERSION__ === 'string' ? __SSG_VERSION__ : '0.0.0-dev';
setUserAgent('slopsquatshield', VERSION);

// Self-heal: if the launcher's recorded Node/CLI path went stale (Node upgraded, package
// reinstalled) and this run is a persistent install, repair it. Skipped for `hook` — a hook
// call must stay on the fast path — and best-effort: refreshLauncherIfStale never throws.
if (process.argv[2] !== 'hook') {
  try {
    refreshLauncherIfStale({ location: detectSelfLocation() });
  } catch {
    // Not being able to locate ourselves must never break the actual command.
  }
}

// `--version` prints the bare version on stdout (scripts and the smoke test compare it exactly) and
// the credit on stderr, where a person sees it and `$(slopsquatshield --version)` doesn't. This
// listener must be registered *before* `.version()`: Commander's own handler exits the process.
program.on('option:version', () => process.stderr.write(`${CREDIT}\n`));

program
  .name('slopsquatshield')
  .description('Install-time detector for hallucinated packages')
  .addHelpText('after', `\n${CREDIT}`)
  .version(VERSION)
  // Program-level options (--version/--help) only count *before* the subcommand, so the
  // npm|pip|mvn wrappers below can forward them to the real tool untouched.
  .enablePositionalOptions();

program
  .command('scan')
  .description('Scan a directory for hallucinated/slopsquat package names')
  .argument('[path]', 'directory to scan', '.')
  .option('--json', 'machine-readable output')
  .option('--report-only', 'show findings but always exit 0 — visibility first, no enforcement')
  .option(
    '--maven-tree',
    'also run `mvn dependency:tree` in the project (runs project-controlled Maven config and plugins: trusted projects only)',
  )
  .action(
    async (path: string, opts: { json?: boolean; reportOnly?: boolean; mavenTree?: boolean }) => {
      const report = await runScan(path, { mavenTree: opts.mavenTree });
      const format = { reportOnly: opts.reportOnly };
      const paths = { cwd: process.cwd(), home: homedir() };
      process.stdout.write(
        `${opts.json ? formatScanJson(report, format) : formatScanReport(report, { ...format, paths })}\n`,
      );
      process.exitCode = opts.reportOnly ? 0 : report.exitCode;
    },
  );

function registerInstallWrapper(tool: InstallTool): void {
  program
    .command(tool)
    .description(`Verified ${tool} passthrough — blocks BLOCK-tier installs`)
    .allowUnknownOption()
    // Everything after the tool name belongs to the real tool: `npm --version`, `npm install
    // --help`, `pip -V` must reach it, not be swallowed by commander (an early version had this bug).
    .passThroughOptions()
    .helpOption(false)
    .argument('[args...]', `arguments to forward to the real ${tool}`)
    .action(async (args: string[]) => {
      process.exitCode = await runInstallWrapper(tool, args);
    });
}

registerInstallWrapper('npm');
registerInstallWrapper('pip');
registerInstallWrapper('mvn');

program
  .command('init')
  .description('Detect project type and configure requested surfaces')
  .option('--shell', 'install the bash/zsh/PowerShell function wrapper')
  .option('--claude-code', 'write the Claude Code PreToolUse hook config')
  .option('--cursor', 'write the Cursor beforeShellExecution hook config')
  .option('--codex', 'write the Codex CLI PreToolUse hook config')
  .option('--antigravity', 'write the Antigravity PreToolUse hook config')
  .option('--git-hook', 'install .git/hooks/pre-commit in this repository (advisory)')
  .option('--ci', 'write PATH-shim executables for non-interactive shells')
  .option('--project', 'write hook configs into this project instead of your user-level config')
  .option('--all', 'shell wrapper + a hook for every agent host found on this machine')
  .option('--json', 'print the raw result as JSON instead of a summary')
  .action(
    (opts: {
      shell?: boolean;
      claudeCode?: boolean;
      cursor?: boolean;
      codex?: boolean;
      antigravity?: boolean;
      gitHook?: boolean;
      ci?: boolean;
      project?: boolean;
      all?: boolean;
      json?: boolean;
    }) => {
      const result = runInit(process.cwd(), opts);
      const summary = formatInitResult(result, { paths: { cwd: process.cwd(), home: homedir() } });
      process.stdout.write(`${opts.json ? JSON.stringify(result, null, 2) : summary.text}\n`);
      // A surface that was asked for but could not be configured is a failure, not a quiet success.
      if (!summary.ok) process.exitCode = 1;
    },
  );

program
  .command('precommit')
  .description('Advisory scan of staged manifests for a git pre-commit hook; only a BLOCK fails')
  .argument('[files...]', 'files to check (the pre-commit framework passes them)')
  .option('--staged', 'read the staged files from git instead of arguments (direct hook mode)')
  .action(async (files: string[], opts: { staged?: boolean }) => {
    try {
      const staged = opts.staged ? listStagedFiles(process.cwd()) : undefined;
      const result = await runPrecommit(staged?.root ?? process.cwd(), staged?.files ?? files);
      if (result.output) process.stderr.write(`${result.output}\n`);
      process.exitCode = result.exitCode;
    } catch (err) {
      // Advisory surface, fail open: a problem in the hook itself must never block a commit.
      process.stderr.write(
        `slopsquatshield: pre-commit check skipped — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 0;
    }
  });

program
  .command('allow')
  .description('Add a package to .slopsquatshield so its findings are suppressed')
  .argument('<identifier>', 'package name, or groupId:artifactId for Maven')
  .action((identifier: string) => {
    try {
      const result = runAllow(process.cwd(), identifier);
      process.stdout.write(
        result === 'added'
          ? `Added ${identifier} to .slopsquatshield: its findings are now hidden in this project. Delete that line to undo.\n`
          : `${identifier} is already in .slopsquatshield, so its findings are already hidden here.\n`,
      );
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    }
  });

program
  .command('doctor')
  .description('Report per-surface config state with exact fix commands')
  .action(async () => {
    const report = await runDoctor(process.cwd());
    const paths = { cwd: process.cwd(), home: homedir() };
    process.stdout.write(`${formatDoctorReport(report, { paths })}\n`);
    process.exitCode = report.checks.some((c) => c.status !== 'ok') ? 1 : 0;
  });

program
  .command('uninstall')
  .description(
    'Remove everything `init` set up: the shell wrapper, agent hooks, the git hook and the launcher',
  )
  .option('--dry-run', 'show what would be removed without changing anything')
  .option('--purge', 'also delete the local registry cache')
  .option('--json', 'print the raw result as JSON instead of a summary')
  .action((opts: { dryRun?: boolean; purge?: boolean; json?: boolean }) => {
    const result = runUninstall(process.cwd(), { dryRun: opts.dryRun, purge: opts.purge });
    process.stdout.write(
      `${opts.json ? JSON.stringify(result, null, 2) : formatUninstallResult(result, { paths: { cwd: process.cwd(), home: homedir() } })}\n`,
    );
    // Something that couldn't be removed safely (a config that isn't valid JSON) is a failure.
    if (!result.ok) process.exitCode = 1;
  });

const hook = program
  .command('hook')
  .description('Agent-hook entry points — read stdin, write stdout');

/**
 * Runs a host's hook: shared check → that host's formatter. Any unexpected error fails open
 * (allow + a stderr line) — a bug here must never block or stall the agent (NFR-3.1) — and the
 * process always exits 0 so the decision travels in the stdout body, not the exit code.
 */
async function runHook(
  host: HookHost,
  format: (result: HookCheckResult, caller?: 'cursor') => { stdout: string; stderr?: string },
): Promise<void> {
  try {
    const result = await runHookCheckFromStdin({ host });
    const { stdout, stderr } = format(result, result.caller);
    if (stdout) process.stdout.write(`${stdout}\n`);
    if (stderr) process.stderr.write(`${stderr}\n`);
  } catch (err) {
    process.stderr.write(
      `slopsquatshield: hook error, allowing the command — ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

hook
  .command('claude-code')
  .description('Claude Code PreToolUse hook')
  .action(() =>
    runHook('claude-code', (r, caller) => ({
      stdout: formatClaudeCodeHookOutput(r, { caller }),
    })),
  );

hook
  .command('cursor')
  .description('Cursor beforeShellExecution hook')
  .action(() => runHook('cursor', (r) => ({ stdout: formatCursorHookOutput(r) })));

hook
  .command('codex')
  .description('Codex CLI PreToolUse hook — deny-only')
  .action(() => runHook('codex', formatCodexHookOutput));

hook
  .command('antigravity')
  .description('Antigravity PreToolUse hook')
  .action(() => runHook('antigravity', (r) => ({ stdout: formatAntigravityHookOutput(r) })));

program.parse();
