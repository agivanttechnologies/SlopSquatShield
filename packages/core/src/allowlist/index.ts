// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * Parses `.slopsquatshield` (FR-5.1): one identifier per line — a bare package name, or
 * `groupId:artifactId` for Maven — with `#`-prefixed comments and blank lines ignored.
 * The same parser is used by every surface (FR-5.2), so allowlist matching can never
 * drift between the CLI, the shell wrapper, and the agent-hook adapters.
 */
export function parseAllowlist(content: string): Set<string> {
  const identifiers = new Set<string>();
  for (const rawLine of content.split('\n')) {
    const withoutComment = rawLine.split('#')[0] ?? '';
    const identifier = withoutComment.trim();
    if (identifier) identifiers.add(identifier);
  }
  return identifiers;
}

/** FR-5.1: an allowlisted identifier suppresses every finding for it, including BLOCK. */
export function isAllowlisted(identifier: string, allowlist: ReadonlySet<string>): boolean {
  return allowlist.has(identifier);
}

/**
 * Pure string transform for `slopsquatshield allow <identifier>` (FR-5.3): appends a new
 * line, creating the file's content from scratch when `currentContent` is `undefined`
 * (the caller creates the file on disk if it didn't already exist). Kept side-effect-free
 * here per the "one engine, thin adapters" invariant — the CLI does the actual file I/O.
 */
export function appendToAllowlist(currentContent: string | undefined, identifier: string): string {
  const base = currentContent ?? '';
  if (base.length === 0) return `${identifier}\n`;
  const separator = base.endsWith('\n') ? '' : '\n';
  return `${base}${separator}${identifier}\n`;
}
