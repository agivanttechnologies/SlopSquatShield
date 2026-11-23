// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { powerShellProfiles } from '../../src/shell/profile-paths.js';

describe('powerShellProfiles', () => {
  const home = join('/fake', 'home');

  it('on Windows gives both editions, under <home>/Documents by default', () => {
    expect(powerShellProfiles({ home, platform: 'win32' })).toEqual([
      {
        label: 'PowerShell 7',
        path: join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      },
      {
        label: 'Windows PowerShell 5.1',
        path: join(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
      },
    ]);
  });

  it('on Windows uses the Documents folder Windows reports (OneDrive)', () => {
    const documentsDir = join('/fake', 'OneDrive', 'Documents');
    const profiles = powerShellProfiles({ home, platform: 'win32', documentsDir });
    expect(profiles.map((p) => p.path)).toEqual([
      join(documentsDir, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      join(documentsDir, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ]);
  });

  it('elsewhere gives one profile under ~/.config, whatever the real OS is', () => {
    expect(powerShellProfiles({ home, platform: 'linux' })).toEqual([
      {
        label: 'PowerShell',
        path: join(home, '.config', 'powershell', 'Microsoft.PowerShell_profile.ps1'),
      },
    ]);
  });

  it('ignores a Documents folder off Windows', () => {
    const [only] = powerShellProfiles({ home, platform: 'darwin', documentsDir: '/x' });
    expect(only.path.startsWith(join(home, '.config'))).toBe(true);
  });
});
