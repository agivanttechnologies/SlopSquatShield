// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { ExtractedDependency } from '../types.js';

// name[extra1,extra2]specifier — e.g. "requests[socks]>=2.31,<3" or "numpy==1.26.4".
// Environment markers after ';' are captured but not evaluated (FR-2 territory, not FR-1).
const REQUIREMENT_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?\s*([^;#]*)/;

export interface ParsedRequirement {
  name: string;
  specifier?: string;
  extras?: string[];
}

/** Parses a single PEP 508 requirement string (no line-comment/directive handling). */
export function parseRequirementString(text: string): ParsedRequirement | undefined {
  const match = REQUIREMENT_RE.exec(text.trim());
  if (!match) return undefined;

  const [, name, extrasRaw, specifierRaw] = match;
  const specifier = specifierRaw.trim();
  const extras = extrasRaw
    ? extrasRaw
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
    : undefined;

  return { name, specifier: specifier || undefined, extras };
}

/**
 * Hand-rolled PEP 508 line parser for requirements.txt (FR-1.2). A regex parser is
 * more auditable here than pulling in a dependency, per the tech-stack decision.
 * Blank lines, comments, and non-name directives (-r, -e, --hash, etc.) are soft-skipped
 * rather than erroring, consistent with failing open on the unparseable.
 */
export function extractRequirementsTxtDeps(
  content: string,
  source = 'requirements.txt',
): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;

    const parsed = parseRequirementString(line);
    if (!parsed) continue;

    deps.push({
      name: parsed.name,
      ecosystem: 'pypi',
      specifier: parsed.specifier,
      extras: parsed.extras,
      source,
    });
  }

  return deps;
}
