// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';

/**
 * The folder Windows calls "Documents" — where both PowerShell editions look for their profile.
 * It is not always `<home>\Documents`: OneDrive's folder backup moves it to
 * `<home>\OneDrive\Documents`, and then a profile written under the plain path is never read.
 *
 * Asks Windows directly (`[Environment]::GetFolderPath('MyDocuments')`). Returns `undefined` on any
 * other platform, or if `powershell.exe` can't be run or answers nothing — the caller then falls
 * back to `<home>\Documents`. It must fail open like `detectWslHome`. Called only by `init`,
 * `doctor` and `uninstall`, never on the hook or wrapper path, so the process start is not a
 * latency cost where latency matters.
 */
export function detectDocumentsDir(): string | undefined {
  if (process.platform !== 'win32') return undefined;
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('MyDocuments')"],
      { encoding: 'utf-8', timeout: 10_000, windowsHide: true },
    ).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}
