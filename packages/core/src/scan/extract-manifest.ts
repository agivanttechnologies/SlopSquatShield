// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { XMLValidator } from 'fast-xml-parser';
import { extractMavenDeps } from '../extractors/maven.js';
import { extractNpmDeps } from '../extractors/npm.js';
import { extractPythonDeps } from '../extractors/python/index.js';
import type { ExtractedDependency } from '../extractors/types.js';
import { ManifestParseError } from './manifest-error.js';
import { parseJsonLocated } from './parse-json.js';

/** The manifest file names `extractDependenciesFromManifest` understands. */
export const SUPPORTED_MANIFEST_NAMES = [
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'pom.xml',
] as const;

export type SupportedManifestName = (typeof SUPPORTED_MANIFEST_NAMES)[number];

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function isSupportedManifest(path: string): boolean {
  return (SUPPORTED_MANIFEST_NAMES as readonly string[]).includes(baseName(path));
}

/**
 * Throws a `ManifestParseError` if `content` isn't well-formed XML. `fast-xml-parser`'s own
 * parse is lenient and silently misreads a broken POM, so it is validated explicitly first.
 * Exported because the CLI hands every POM in a project to `extractMavenDeps` together and so
 * can't go through `extractDependenciesFromManifest` for the check.
 */
export function assertWellFormedPom(path: string, content: string): void {
  const result = XMLValidator.validate(content);
  if (result !== true) {
    throw new ManifestParseError(
      path,
      result.err.line,
      result.err.col,
      describeXmlError(result.err.msg),
    );
  }
}

/**
 * fast-xml-parser reports an unclosed document as `Invalid '["project","dependencies"]' found.`
 * (a stringified stack of the open tags) — say that in words; pass anything else through,
 * with whitespace collapsed so the report stays on one line.
 */
function describeXmlError(message: string): string {
  const unclosed = /^Invalid '\[([\s\S]*)\]' found\.?$/.exec(message);
  if (unclosed) {
    const tags = unclosed[1].split(',').map((t) => t.trim().replace(/^"|"$/g, ''));
    return `Malformed XML: unclosed element(s) ${tags.join(' > ')}`;
  }
  return `Malformed XML: ${message.replace(/\s+/g, ' ').trim()}`;
}

/** smol-toml's `TomlError` carries 1-based `line`/`column`; anything else is rethrown as-is. */
function asManifestParseError(path: string, err: unknown): unknown {
  if (err instanceof ManifestParseError) return err;
  if (
    err instanceof Error &&
    typeof (err as { line?: unknown }).line === 'number' &&
    typeof (err as { column?: unknown }).column === 'number'
  ) {
    const { line, column } = err as unknown as { line: number; column: number };
    // The first line of a TomlError message is the reason; the rest is a code excerpt.
    return new ManifestParseError(path, line, column, err.message.split('\n')[0]);
  }
  return err;
}

/**
 * Maps one manifest's text to its declared dependencies by file name — the single
 * "which extractor for which file" dispatcher, shared by the CLI scan and the editor
 * extension so neither re-implements parsing. Returns `[]` for an unsupported file name.
 *
 * A manifest that can't be parsed throws a `ManifestParseError` carrying `file:line:column`
 * (NFR-3.3) — never a raw `SyntaxError`/`TomlError` stack trace.
 *
 * For `pom.xml` this treats the one file in isolation; the CLI passes every POM in a project
 * together to `extractMavenDeps` so parent/child resolution still works.
 */
export function extractDependenciesFromManifest(
  path: string,
  content: string,
): ExtractedDependency[] {
  try {
    switch (baseName(path)) {
      case 'package.json':
        // extractNpmDeps has no file-path knowledge — its `source` is the field name(s)
        // (e.g. "dependencies"), so the manifest path is folded in here.
        return extractNpmDeps(parseJsonLocated(path, content)).map((dep) => ({
          ...dep,
          source: `${path} [${dep.source}]`,
        }));
      case 'requirements.txt':
      case 'pyproject.toml':
      case 'Pipfile':
        return extractPythonDeps(path, content);
      case 'pom.xml':
        assertWellFormedPom(path, content);
        return extractMavenDeps([{ path, content }]);
      default:
        return [];
    }
  } catch (err) {
    throw asManifestParseError(path, err);
  }
}
