// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { parse as parseToml } from 'smol-toml';
import type { ExtractedDependency } from '../types.js';

type PipfileDependencyValue = string | { version?: string; extras?: string[] };

interface PipfileShape {
  packages?: Record<string, PipfileDependencyValue>;
  'dev-packages'?: Record<string, PipfileDependencyValue>;
}

/** Extracts deps from a Pipfile (FR-1.2) — TOML-compatible, [packages]/[dev-packages]. */
export function extractPipfileDeps(content: string, source = 'Pipfile'): ExtractedDependency[] {
  const doc = parseToml(content) as PipfileShape;
  const deps: ExtractedDependency[] = [];

  const sections: [string, Record<string, PipfileDependencyValue> | undefined][] = [
    ['[packages]', doc.packages],
    ['[dev-packages]', doc['dev-packages']],
  ];

  for (const [sectionLabel, entries] of sections) {
    for (const [name, value] of Object.entries(entries ?? {})) {
      if (typeof value === 'string') {
        deps.push({
          name,
          ecosystem: 'pypi',
          specifier: value === '*' ? undefined : value,
          source: `${source} ${sectionLabel}`,
        });
      } else {
        deps.push({
          name,
          ecosystem: 'pypi',
          specifier: value.version,
          extras: value.extras,
          source: `${source} ${sectionLabel}`,
        });
      }
    }
  }

  return deps;
}
