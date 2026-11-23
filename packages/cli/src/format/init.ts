// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { InitResult } from '../commands/init.js';
import { type DisplayPathContext, displayPath } from './paths.js';
import { type Style, createStyle, creditLines } from './style.js';

export interface InitSummary {
  /** The human-readable report, ready to print. */
  text: string;
  /** False when something the person asked for could not be configured (the exit code is then 1). */
  ok: boolean;
}

const WORDS: Record<string, string> = {
  installed: 'installed',
  'already-installed': 'already set up',
  upgraded: 'upgraded in place',
};
const word = (status: string): string => WORDS[status] ?? status;

/**
 * What `init` did, in plain words: what was written, what was left alone and why, and what to do
 * next. (`init --json` still prints the raw result for scripts.) Every surface the person asked for
 * that could not be configured is marked and makes `ok` false, so the exit code can say so — before
 * this, a refused git hook or an unreadable config file looked exactly like success.
 */
export function formatInitResult(
  result: InitResult,
  options: { style?: Style; paths?: DisplayPathContext } = {},
): InitSummary {
  const style = options.style ?? createStyle(process.stdout);
  const show = (path: string) => (options.paths ? displayPath(path, options.paths) : path);
  const OK = style.green(style.sym.ok);
  const NO = style.red(style.sym.block);
  const DOT = style.dim(style.sym.dot);
  const done: string[] = [];
  const failed: string[] = [];
  const notes: string[] = [];
  const line = (mark: string, label: string, detail: string) =>
    `  ${mark} ${label.padEnd(16)} ${detail}`;

  notes.push(
    line(
      DOT,
      'Project',
      result.detectedEcosystems.length > 0
        ? `found ${result.detectedEcosystems.join(', ')} manifests here`
        : 'no package manifests here',
    ),
    line(
      DOT,
      'Allowlist',
      result.allowlist === 'created'
        ? 'created .slopsquatshield'
        : '.slopsquatshield already exists',
    ),
  );

  if (result.launcher?.status === 'written') {
    done.push(line(OK, 'Launcher', show(result.launcher.path)));
  } else if (result.launcher?.status === 'refused-ephemeral') {
    failed.push(line(NO, 'Launcher', result.launcher.message));
  }

  if (result.shell) {
    const parts = [
      `bash ${word(result.shell.bash)}`,
      `zsh ${word(result.shell.zsh)}`,
      ...result.shell.powershell.map((p) => `${p.label} ${word(p.result)}`),
    ];
    if (result.shell.wsl) {
      parts.push(
        `${result.shell.wsl.distro}: bash ${word(result.shell.wsl.bash)}, zsh ${word(result.shell.wsl.zsh)}`,
      );
    }
    done.push(line(OK, 'Shell wrapper', parts.join('; ')));
  }

  const hooks: Array<[string, string | undefined]> = [
    ['Claude Code', result.claudeCodeHook],
    ['Claude Code (WSL)', result.claudeCodeHookWsl],
    ['Cursor', result.cursorHook],
    ['Codex CLI', result.codexHook],
    ['Codex CLI (WSL)', result.codexHookWsl],
    ['Antigravity', result.antigravityHook],
  ];
  for (const [host, status] of hooks) {
    if (status === undefined) continue;
    if (status === 'invalid-json') {
      failed.push(
        line(
          NO,
          host,
          'its config file is not valid JSON, so it was left untouched — fix it and re-run',
        ),
      );
    } else {
      done.push(line(OK, host, `hook ${word(status)}`));
    }
  }

  if (result.gitHook) {
    const { result: status, path } = result.gitHook;
    if (status === 'not-a-repo') {
      failed.push(line(NO, 'Git hook', 'not inside a git repository, so nothing was written'));
    } else if (status === 'unsupported-existing-hook') {
      failed.push(
        line(
          NO,
          'Git hook',
          `${path ? show(path) : 'the existing pre-commit hook'} is not a shell script, so it was left untouched; run \`slopsquatshield precommit --staged\` from it yourself`,
        ),
      );
    } else {
      done.push(
        line(OK, 'Git hook', `${path ? show(path) : '.git/hooks/pre-commit'} ${word(status)}`),
      );
    }
  }

  if (result.ciShims) {
    done.push(line(OK, 'CI shims', `${result.ciShims.length} PATH shim(s) written`));
  }

  if (result.detectedHosts && result.detectedHosts.length === 0) {
    notes.push(
      line(
        DOT,
        'Agents',
        'no agent host found (looked for Claude Code, Cursor, Codex, Antigravity)',
      ),
    );
  }

  const out: string[] = [];
  if (done.length > 0) out.push('Set up:', ...done, '');
  if (failed.length > 0) out.push('Not set up:', ...failed, '');
  out.push('Also:', ...notes);
  if (done.length > 0) {
    // Only the steps that apply to what was actually set up (a hook-only init has no shell to reload).
    const hookSet = hooks.some(([, status]) => status !== undefined && status !== 'invalid-json');
    const steps = [
      result.shell || result.ciShims ? 'open a new terminal so the shell wrapper loads' : '',
      hookSet ? 'restart your AI agent so it picks up the hook' : '',
      'run `slopsquatshield doctor` to check',
    ].filter(Boolean);
    const sentence =
      steps.length > 1 ? `${steps.slice(0, -1).join(', ')}, then ${steps.at(-1)}` : steps[0];
    out.push('', `Next: ${sentence}.`);
  }
  out.push(...creditLines(style));
  return { text: out.join('\n'), ok: failed.length === 0 };
}
