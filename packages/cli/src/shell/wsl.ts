// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';

export interface WslHome {
  distro: string;
  /** The WSL-side POSIX home path (e.g. `/home/user`) — for display only. */
  posixPath: string;
  /** The Windows-visible UNC translation of that path — the one that's actually writable. */
  windowsPath: string;
}

/**
 * On Windows, a plain POSIX path like `/home/user` is NOT reachable from a native Windows
 * Node process — it resolves relative to the current drive root instead (silently writing to
 * the wrong place rather than failing loudly). This matters because `os.homedir()` always
 * resolves to the Windows profile even when the whole invocation chain runs *inside* WSL
 * (`node.exe` is a Windows binary; WSL's interop layer doesn't forward `HOME`), so a CLI
 * invoked from a WSL bash session has no way to know its real `$HOME` is `/home/user`, not
 * `C:\Users\...`, without asking WSL directly.
 *
 * `wsl.exe` (a standard Windows System32 binary whenever WSL is installed, reachable from any
 * Windows process, not just one already running under WSL) answers that: this queries the
 * default distro's `$HOME` and translates it to the `\\wsl.localhost\<distro>\...` UNC form
 * that Windows Node can actually read and write. Returns `undefined` on any platform other
 * than win32, or when no WSL distro is reachable — this is a nice-to-have enhancement, not a
 * hard dependency, and must fail open (NFR-3.1's spirit) rather than blocking `init`/`doctor`
 * on a machine with WSL uninstalled or misconfigured.
 */
export function detectWslHome(): WslHome | undefined {
  if (process.platform !== 'win32') return undefined;

  try {
    const distro = execFileSync('wsl.exe', ['-e', 'printenv', 'WSL_DISTRO_NAME'], {
      encoding: 'utf-8',
    }).trim();
    if (!distro) return undefined;

    // One combined call for both HOME values — `-e` runs the command directly without a
    // shell, so `$HOME` needs an explicit `sh -c` wrapper to expand at all.
    const output = execFileSync('wsl.exe', ['-e', 'sh', '-c', 'echo "$HOME"; wslpath -w "$HOME"'], {
      encoding: 'utf-8',
    });
    const [posixPath, windowsPath] = output
      .trim()
      .split('\n')
      .map((line) => line.trim());
    if (!posixPath || !windowsPath) return undefined;

    return { distro, posixPath, windowsPath };
  } catch {
    return undefined;
  }
}
