// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { locateJsonError } from './json-error.js';
import { ManifestParseError, offsetToLineColumn } from './manifest-error.js';

/**
 * `JSON.parse` that turns a failure into a located `ManifestParseError` (`file:line:column`),
 * never a raw `SyntaxError`. Shared by manifest extraction and config loading (NFR-3.3).
 */
export function parseJsonLocated(path: string, content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (err) {
    const fallback = err instanceof Error ? err.message : String(err);
    const found = locateJsonError(content);
    const { line, column } = offsetToLineColumn(content, found?.offset ?? 0);
    throw new ManifestParseError(path, line, column, found?.reason ?? fallback);
  }
}
