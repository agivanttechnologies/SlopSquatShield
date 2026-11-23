// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Ecosystem } from '../extractors/types.js';

/**
 * A project's expected-private naming conventions (FR-6.1) — an npm scope, a PyPI naming
 * pattern for its private index, and/or a Maven `groupId` prefix. Any of the three can be
 * configured independently; an ecosystem with nothing configured never flags confusion.
 */
export interface PrivateScopeConfig {
  npmScopes?: string[];
  pypiIndexPattern?: RegExp;
  mavenGroupPrefixes?: string[];
}

function isPrivateMavenGroup(identifier: string, prefixes: string[]): boolean {
  const groupId = identifier.split(':')[0];
  if (!groupId) return false;
  return prefixes.some((prefix) => groupId === prefix || groupId.startsWith(`${prefix}.`));
}

/**
 * True when `identifier` matches a naming convention the project has declared as
 * private-only (FR-6.1). This is the trigger for dependency-confusion detection: a name
 * that *should* only exist in a private registry but resolves successfully on the
 * *public* one is a confusion attack, not a hallucination — the rule engine gives it a
 * distinct BLOCK reason from non-existence.
 */
export function isExpectedPrivate(
  identifier: string,
  ecosystem: Ecosystem,
  config: PrivateScopeConfig,
): boolean {
  switch (ecosystem) {
    case 'npm':
      return (config.npmScopes ?? []).some((scope) => identifier.startsWith(`${scope}/`));
    case 'pypi':
      return config.pypiIndexPattern?.test(identifier) ?? false;
    case 'maven':
      return isPrivateMavenGroup(identifier, config.mavenGroupPrefixes ?? []);
    default:
      return false;
  }
}
