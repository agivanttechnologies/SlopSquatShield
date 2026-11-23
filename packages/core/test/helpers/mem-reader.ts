// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from 'node:path';
import type { ManifestReader } from '../../src/scan/manifest-install.js';

/**
 * An in-memory {@link ManifestReader}: a map of file path -> text. Directories exist implicitly
 * wherever a file lives under them. Counts reads so a test can prove a file was (not) touched.
 */
export function memReader(files: Record<string, string>): ManifestReader & { reads: string[] } {
  const reads: string[] = [];
  const dirs = new Set<string>();
  for (const path of Object.keys(files)) {
    for (let dir = dirname(path); !dirs.has(dir); dir = dirname(dir)) {
      dirs.add(dir);
      if (dirname(dir) === dir) break;
    }
  }
  return {
    reads,
    readFile(path) {
      reads.push(path);
      return files[path];
    },
    exists: (path) => path in files || dirs.has(path),
    listDirs(path) {
      if (!dirs.has(path)) return undefined;
      return [...dirs]
        .filter((d) => dirname(d) === path && d !== path)
        .map((d) => d.slice(path.length).replace(/^[\\/]/, ''));
    },
  };
}

/**
 * `resolve('/proj', …)`: an absolute path in the form the code under test produces. On Windows that
 * includes the current drive (`D:\proj\…`), which `path.resolve` adds and `join` would not.
 */
export const at = (...parts: string[]): string => resolve('/proj', ...parts);
