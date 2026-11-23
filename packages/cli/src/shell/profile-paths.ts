// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * `home` is injectable rather than always reading `os.homedir()` internally — on Windows,
 * `os.homedir()` reads `USERPROFILE` and ignores a `HOME` env-var override entirely, which
 * makes the usual "override HOME for an isolated test" trick silently no-op there and
 * write into the real user's profile instead. Every caller in this codebase must pass an
 * explicit `home` in tests; production code omits it and gets the real one.
 */
export function bashProfilePath(home: string = homedir()): string {
  return join(home, '.bashrc');
}

export function zshProfilePath(home: string = homedir()): string {
  return join(home, '.zshrc');
}

export interface PowerShellProfile {
  /** Which PowerShell reads this file — shown to the person running `init`/`doctor`. */
  label: string;
  path: string;
}

const PROFILE_FILE = 'Microsoft.PowerShell_profile.ps1';

/**
 * Every PowerShell profile `init --shell` writes, `doctor` checks and `uninstall` cleans.
 *
 * On Windows that is two files: PowerShell 7+ (`pwsh`) reads `<Documents>\PowerShell\...`, and the
 * Windows PowerShell 5.1 that ships with Windows (`powershell.exe`) reads
 * `<Documents>\WindowsPowerShell\...`. Writing only the first left a 5.1 window with the real
 * `npm` and no warning. `<Documents>` is `documentsDir` — the folder Windows reports, which OneDrive
 * can move — falling back to `<home>\Documents`. Elsewhere there is one file under `~/.config`.
 *
 * `platform` is a parameter, not `process.platform`, so the Windows paths can be tested anywhere.
 */
export function powerShellProfiles(options: {
  home?: string;
  platform?: string;
  documentsDir?: string;
}): PowerShellProfile[] {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return [{ label: 'PowerShell', path: join(home, '.config', 'powershell', PROFILE_FILE) }];
  }
  const documents = options.documentsDir ?? join(home, 'Documents');
  return [
    { label: 'PowerShell 7', path: join(documents, 'PowerShell', PROFILE_FILE) },
    { label: 'Windows PowerShell 5.1', path: join(documents, 'WindowsPowerShell', PROFILE_FILE) },
  ];
}
