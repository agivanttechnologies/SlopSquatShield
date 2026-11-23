// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { ManifestReader } from '@slopsquatshield/core';

/**
 * The real-filesystem {@link ManifestReader}: the adapter half of "core decides what a manifest
 * means, the CLI reads the file". Every method swallows I/O errors (permissions, a file deleted
 * mid-check, a path this process can't see) and reports "not there" — a hook must never crash or
 * stall on a filesystem oddity (NFR-3.1).
 */
export const nodeManifestReader: ManifestReader = {
  readFile(path) {
    try {
      return readFileSync(path, 'utf-8');
    } catch {
      return undefined;
    }
  },
  listDirs(path) {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
        .map((entry) => entry.name);
    } catch {
      return undefined;
    }
  },
  exists(path) {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  },
};
