// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * The absolute path of `command` found on `PATH`, or `undefined` if it isn't there.
 *
 * Only absolute `PATH` entries are searched, never the current directory. Spawning a bare name lets
 * the OS look in the working directory first on Windows, so an `mvn.exe` shipped inside a scanned
 * repository would run; an empty or relative `PATH` entry (`::`, `.`) does the same on any
 * platform. Resolving the path here first means a scanned project can never supply the binary.
 */
export function findOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const pathValue = env.PATH ?? env.Path ?? '';
  const extensions =
    platform === 'win32'
      ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : [''];
  const sep = platform === 'win32' ? ';' : delimiter;
  for (const dir of pathValue.split(sep)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const ext of extensions) {
      const candidate = join(dir, command + ext.toLowerCase());
      const upper = join(dir, command + ext);
      for (const path of ext ? [candidate, upper] : [candidate]) {
        try {
          if (statSync(path).isFile()) return path;
        } catch {
          // not here
        }
      }
    }
  }
  return undefined;
}
