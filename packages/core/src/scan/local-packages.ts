// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { isLocalNpmSpecifier } from '../extractors/npm.js';
import type { ExtractedDependency } from '../extractors/types.js';

/** The `name` field of a package.json's text, or `undefined` if it has none or isn't valid JSON. */
export function packageJsonName(content: string): string | undefined {
  try {
    const name = (JSON.parse(content) as { name?: unknown }).name;
    return typeof name === 'string' && name !== '' ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Drops npm dependencies that are local to the project: a workspace member (its name is some
 * other package.json's `name`, e.g. `@scope/core: "*"` in a monorepo) or anything whose specifier
 * is a path, link, git URL or tarball URL. They are not published to the registry, so checking
 * them would only produce a false "does not exist" — and, now that a lockfile pin no longer
 * skips the checks, they would start doing so in monorepos that used to look clean.
 * Non-npm dependencies pass through untouched.
 */
export function excludeLocalPackages(
  deps: ExtractedDependency[],
  localNames: ReadonlySet<string>,
): ExtractedDependency[] {
  return deps.filter(
    (dep) =>
      dep.ecosystem !== 'npm' || !(localNames.has(dep.name) || isLocalNpmSpecifier(dep.specifier)),
  );
}
