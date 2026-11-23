// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { ExtractedDependency } from './types.js';

/**
 * True for a dependency specifier that points at something other than the public registry — a
 * local path, a workspace link, a git URL or a tarball URL. Such a name is not expected to exist
 * on npm, so looking it up would only produce a false "does not exist".
 */
export function isLocalNpmSpecifier(specifier: string | undefined): boolean {
  if (!specifier) return false;
  return /^(?:file:|link:|workspace:|portal:|git\+|git:|github:|gitlab:|bitbucket:|https?:|\.{1,2}\/|~\/|\/)/i.test(
    specifier.trim(),
  );
}

/**
 * Resolves npm's alias protocol. `"lodash": "npm:some-pkg@^1"` (or `npm install lodash@npm:some-pkg`)
 * installs **`some-pkg`** under the folder `node_modules/lodash`, so the package to check is
 * `some-pkg`, not `lodash` — checking the declared name let any package through behind a popular
 * one. Returns the real name and its version range, with the declared name kept as `alias`;
 * anything that isn't an `npm:` specifier comes back unchanged.
 */
export function resolveNpmAlias(
  name: string,
  specifier: string | undefined,
): { name: string; specifier?: string; alias?: string } {
  const trimmed = specifier?.trim();
  if (!trimmed || !/^npm:/i.test(trimmed)) return { name, specifier };
  const rest = trimmed.slice(4);
  const at = rest.startsWith('@') ? rest.indexOf('@', 1) : rest.indexOf('@');
  const target = at === -1 ? rest : rest.slice(0, at);
  if (!target) return { name, specifier };
  return {
    name: target,
    specifier: at === -1 ? undefined : rest.slice(at + 1) || undefined,
    alias: name,
  };
}

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type DepField = (typeof DEP_FIELDS)[number];

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Extracts deps from all four package.json fields (FR-1.1), deduped by name across
 * fields, flagging a conflict when the same name carries different specifiers in
 * two or more fields rather than silently picking one.
 */
export function extractNpmDeps(pkgJson: unknown): ExtractedDependency[] {
  const pkg = (pkgJson ?? {}) as PackageJsonShape;
  const byName = new Map<string, { field: DepField; specifier: string }[]>();

  for (const field of DEP_FIELDS) {
    const entries = pkg[field];
    if (!entries) continue;
    for (const [name, specifier] of Object.entries(entries)) {
      const existing = byName.get(name) ?? [];
      existing.push({ field, specifier });
      byName.set(name, existing);
    }
  }

  const result: ExtractedDependency[] = [];
  for (const [name, occurrences] of byName) {
    const distinctSpecifiers = new Set(occurrences.map((o) => o.specifier));
    const resolved = resolveNpmAlias(name, occurrences[0].specifier);
    const dep: ExtractedDependency = {
      name: resolved.name,
      ecosystem: 'npm',
      specifier: resolved.specifier,
      source: occurrences.map((o) => o.field).join(', '),
    };
    if (resolved.alias !== undefined) dep.alias = resolved.alias;
    if (distinctSpecifiers.size > 1) {
      dep.conflict = {
        fields: occurrences.map((o) => o.field),
        specifiers: occurrences.map((o) => o.specifier),
      };
    }
    result.push(dep);

    // Another field aliasing the same key to a *different* package installs that one too
    // (whichever field npm honours), so it is checked as well rather than hidden by the first.
    const checked = new Set([dep.name]);
    for (const occurrence of occurrences.slice(1)) {
      const other = resolveNpmAlias(name, occurrence.specifier);
      if (other.alias === undefined || checked.has(other.name)) continue;
      checked.add(other.name);
      result.push({
        name: other.name,
        ecosystem: 'npm',
        specifier: other.specifier,
        source: occurrence.field,
        alias: other.alias,
      });
    }
  }

  return result;
}
