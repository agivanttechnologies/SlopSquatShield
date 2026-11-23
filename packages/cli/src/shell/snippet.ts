// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const WRAPPER_MARKER_START = '# >>> slopsquatshield shell wrapper >>>';
export const WRAPPER_MARKER_END = '# <<< slopsquatshield shell wrapper <<<';

/**
 * bash/zsh function definitions (FR-11.1) — a function named `npm`/`pip`/`mvn` is
 * checked before PATH lookup in both shells' command resolution, so this shadows the
 * real binaries without touching PATH itself. Each function forwards through the launcher
 * (`install/launcher.ts`) by its fixed `$HOME`-relative path — never a bare
 * `slopsquatshield`, which depends on PATH containing the Node install dir (nvm/fnm/volta
 * switches break that). The launcher verifies then re-spawns the real binary via
 * `cross-spawn` — never itself, so there's no recursion risk.
 */
export function buildBashZshSnippet(): string {
  const launcher = '"$HOME/.config/slopsquatshield/bin/slopsquatshield"';
  return [
    WRAPPER_MARKER_START,
    `npm() { ${launcher} npm "$@"; }`,
    `pip() { ${launcher} pip "$@"; }`,
    `mvn() { ${launcher} mvn "$@"; }`,
    WRAPPER_MARKER_END,
    '',
  ].join('\n');
}

/**
 * PowerShell function definitions (FR-11.1) — PowerShell's command resolution checks
 * functions before external executables, so this shadows `npm.cmd`/`pip.exe`/`mvn.cmd`
 * the same way the bash/zsh functions shadow their binaries. On Windows it calls the
 * `.ps1` launcher; on Linux/macOS `pwsh` it calls the extensionless `sh` one.
 */
export function buildPowerShellSnippet(platform: string = process.platform): string {
  const launcher =
    platform === 'win32'
      ? '& "$HOME\\.config\\slopsquatshield\\bin\\slopsquatshield.ps1"'
      : '& "$HOME/.config/slopsquatshield/bin/slopsquatshield"';
  return [
    WRAPPER_MARKER_START,
    `function npm { ${launcher} npm @args }`,
    `function pip { ${launcher} pip @args }`,
    `function mvn { ${launcher} mvn @args }`,
    WRAPPER_MARKER_END,
    '',
  ].join('\n');
}

export type SnippetInstallResult = 'installed' | 'already-installed' | 'upgraded';
/** `outdated`: the marker block is there but differs from the current snippet (e.g. the legacy bare-name form). */
export type SnippetState = 'current' | 'outdated' | 'absent';

function markerBlockRange(text: string): { start: number; end: number } | undefined {
  const start = text.indexOf(WRAPPER_MARKER_START);
  if (start === -1) return undefined;
  const endMarker = text.indexOf(WRAPPER_MARKER_END, start);
  if (endMarker === -1) return undefined;
  let end = endMarker + WRAPPER_MARKER_END.length;
  if (text[end] === '\r') end += 1;
  if (text[end] === '\n') end += 1;
  return { start, end };
}

/**
 * Installs `snippet` into `filePath` between the wrapper markers (FR-10.2/FR-11.1's
 * "idempotency-guarded"): absent → appended; present and identical → no-op; present but
 * different (an older snippet form) → the marked block is replaced in place, so re-running
 * `init` after an upgrade fixes the profile instead of leaving the old definitions behind.
 * Creates the file (and its parent directory) if absent.
 */
export function installSnippetToFile(filePath: string, snippet: string): SnippetInstallResult {
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';
  const range = markerBlockRange(existing);

  if (range) {
    if (existing.slice(range.start, range.end) === snippet) return 'already-installed';
    writeFileSync(filePath, existing.slice(0, range.start) + snippet + existing.slice(range.end));
    return 'upgraded';
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  writeFileSync(filePath, `${existing}${separator}\n${snippet}`);
  return 'installed';
}

/**
 * Removes our marked wrapper block from `filePath`, plus the one blank line `installSnippetToFile`
 * put in front of it, and nothing else. `dryRun` reports without writing. Anything the person has
 * in the file outside the markers is left exactly as it was.
 */
export function removeSnippetFromFile(
  filePath: string,
  dryRun = false,
): 'removed' | 'deleted' | 'absent' {
  if (!existsSync(filePath)) return 'absent';
  const text = readFileSync(filePath, 'utf-8');
  const range = markerBlockRange(text);
  if (!range) return 'absent';
  const blankLineBefore = text[range.start - 1] === '\n' && text[range.start - 2] === '\n';
  const start = blankLineBefore ? range.start - 1 : range.start;
  const rest = text.slice(0, start) + text.slice(range.end);
  // A profile that held nothing but our block (init created it) is deleted rather than left empty.
  const onlyOurBlock = rest.trim() === '';
  if (!dryRun) {
    if (onlyOurBlock) rmSync(filePath);
    else writeFileSync(filePath, rest);
  }
  return onlyOurBlock ? 'deleted' : 'removed';
}

export function snippetState(filePath: string, expected: string): SnippetState {
  if (!existsSync(filePath)) return 'absent';
  const text = readFileSync(filePath, 'utf-8');
  const range = markerBlockRange(text);
  if (!range) return 'absent';
  return text.slice(range.start, range.end) === expected ? 'current' : 'outdated';
}

export function isSnippetInstalledInFile(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  return readFileSync(filePath, 'utf-8').includes(WRAPPER_MARKER_START);
}
