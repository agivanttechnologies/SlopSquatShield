// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const GIT_HOOK_MARKER_START = '# >>> slopsquatshield pre-commit >>>';
export const GIT_HOOK_MARKER_END = '# <<< slopsquatshield pre-commit <<<';

/**
 * The block placed in `.git/hooks/pre-commit` (FR-20.4). It calls the stable launcher by its
 * `$HOME`-relative path (so it survives Node/nvm changes, like every other surface) and passes
 * `--staged`, which makes the CLI ask git for the staged files itself. `precommit` only ever
 * exits 0 or 2, so `|| exit $?` blocks the commit on a BLOCK and on nothing else (FR-20.3).
 */
export function buildGitHookBlock(): string {
  return [
    GIT_HOOK_MARKER_START,
    '# Advisory scan of staged manifests. Override order: fix -> `slopsquatshield allow <pkg>` -> `git commit --no-verify`.',
    '"$HOME/.config/slopsquatshield/bin/slopsquatshield" precommit --staged || exit $?',
    GIT_HOOK_MARKER_END,
    '',
  ].join('\n');
}

export type GitHookState = 'current' | 'outdated' | 'absent';
export type GitHookResult =
  | 'installed'
  | 'already-installed'
  | 'upgraded'
  /** Not inside a git repository — nothing written. */
  | 'not-a-repo'
  /** An existing hook in another language (python, node, …) that we can't safely edit. */
  | 'unsupported-existing-hook';

/** Resolves the hooks directory git will actually use (honours `core.hooksPath` and worktrees). */
export function gitHooksDir(
  cwd: string,
  git: (args: string[], dir: string) => string = (args, dir) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }),
): string | undefined {
  try {
    const dir = git(['rev-parse', '--git-path', 'hooks'], cwd).trim();
    return dir ? resolve(cwd, dir) : undefined;
  } catch {
    return undefined;
  }
}

function blockRange(text: string): { start: number; end: number } | undefined {
  const start = text.indexOf(GIT_HOOK_MARKER_START);
  if (start === -1) return undefined;
  const endMarker = text.indexOf(GIT_HOOK_MARKER_END, start);
  if (endMarker === -1) return undefined;
  let end = endMarker + GIT_HOOK_MARKER_END.length;
  if (text[end] === '\r') end += 1;
  if (text[end] === '\n') end += 1;
  return { start, end };
}

/**
 * Removes our block from a pre-commit hook. If nothing else is left (only the shebang `init`
 * wrote), the file is deleted; if someone else's shell hook was chained after ours, it is kept
 * exactly as it was. `dryRun` reports without writing.
 */
export function removeGitHook(hookPath: string, dryRun = false): 'removed' | 'deleted' | 'absent' {
  if (!existsSync(hookPath)) return 'absent';
  const text = readFileSync(hookPath, 'utf-8');
  const range = blockRange(text);
  if (!range) return 'absent';
  const rest = text.slice(0, range.start) + text.slice(range.end);
  const onlyShebang = rest
    .split('\n')
    .every((line, i) => line.trim() === '' || (i === 0 && line.startsWith('#!')));
  if (!dryRun) {
    if (onlyShebang) rmSync(hookPath);
    else writeFileSync(hookPath, rest);
  }
  return onlyShebang ? 'deleted' : 'removed';
}

export function gitHookState(hookPath: string): GitHookState {
  if (!existsSync(hookPath)) return 'absent';
  const text = readFileSync(hookPath, 'utf-8');
  const range = blockRange(text);
  if (!range) return 'absent';
  return text.slice(range.start, range.end) === buildGitHookBlock() ? 'current' : 'outdated';
}

/** True when a hook's first line names a shell (or it has no shebang, which git runs as sh). */
function isShellHook(text: string): boolean {
  if (!text.startsWith('#!')) return true;
  return /^#!\s*(\/usr\/bin\/env\s+)?\S*(ba|z|da|k|a)?sh\b/.test(text.split('\n')[0] ?? '');
}

/**
 * Installs the pre-commit block into `hookPath`, idempotently (FR-20.4):
 *  - no hook yet → a new executable `sh` script;
 *  - our block already there → left alone, or rewritten in place if it's an older form;
 *  - someone else's shell hook → our block is inserted right after the shebang so it runs
 *    *before* their logic (which might `exit 0` early) and their hook is otherwise untouched;
 *  - someone else's hook in another language → refused, never overwritten.
 */
export function installGitHook(hookPath: string): Exclude<GitHookResult, 'not-a-repo'> {
  const block = buildGitHookBlock();

  if (!existsSync(hookPath)) {
    mkdirSync(dirname(hookPath), { recursive: true });
    writeFileSync(hookPath, `#!/bin/sh\n${block}`);
    chmodSync(hookPath, 0o755);
    return 'installed';
  }

  const existing = readFileSync(hookPath, 'utf-8');
  const range = blockRange(existing);
  if (range) {
    if (existing.slice(range.start, range.end) === block) {
      chmodSync(hookPath, 0o755);
      return 'already-installed';
    }
    writeFileSync(hookPath, existing.slice(0, range.start) + block + existing.slice(range.end));
    chmodSync(hookPath, 0o755);
    return 'upgraded';
  }

  if (!isShellHook(existing)) return 'unsupported-existing-hook';

  const lines = existing.split('\n');
  const hasShebang = lines[0]?.startsWith('#!');
  const rest = hasShebang ? lines.slice(1).join('\n') : existing;
  writeFileSync(hookPath, `${hasShebang ? lines[0] : '#!/bin/sh'}\n${block}${rest}`);
  chmodSync(hookPath, 0o755);
  return 'installed';
}
