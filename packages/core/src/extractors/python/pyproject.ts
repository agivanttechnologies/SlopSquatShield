// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { parse as parseToml } from 'smol-toml';
import type { ExtractedDependency } from '../types.js';
import { parseRequirementString } from './requirements.js';

interface PyProjectShape {
  project?: {
    dependencies?: string[];
    'optional-dependencies'?: Record<string, string[]>;
  };
  tool?: {
    poetry?: {
      dependencies?: Record<string, PoetryDependencyValue>;
    };
  };
}

type PoetryDependencyValue = string | { version?: string; extras?: string[] };

/**
 * Extracts deps from pyproject.toml (FR-1.2), covering both shapes a pyproject.toml
 * can take: PEP 621 (`[project.dependencies]` + optional-dependencies groups) and
 * Poetry (`[tool.poetry.dependencies]`). A given file has one shape, not both — both
 * are checked and whichever is present is used.
 */
export function extractPyprojectDeps(
  content: string,
  source = 'pyproject.toml',
): ExtractedDependency[] {
  const doc = parseToml(content) as PyProjectShape;
  const deps: ExtractedDependency[] = [];

  for (const item of doc.project?.dependencies ?? []) {
    const parsed = parseRequirementString(item);
    if (!parsed) continue;
    deps.push({
      name: parsed.name,
      ecosystem: 'pypi',
      specifier: parsed.specifier,
      extras: parsed.extras,
      source: `${source} [project.dependencies]`,
    });
  }

  for (const [group, items] of Object.entries(doc.project?.['optional-dependencies'] ?? {})) {
    for (const item of items) {
      const parsed = parseRequirementString(item);
      if (!parsed) continue;
      deps.push({
        name: parsed.name,
        ecosystem: 'pypi',
        specifier: parsed.specifier,
        extras: parsed.extras,
        source: `${source} [project.optional-dependencies.${group}]`,
      });
    }
  }

  for (const [name, value] of Object.entries(doc.tool?.poetry?.dependencies ?? {})) {
    if (name === 'python') continue; // interpreter constraint, not a package dep
    if (typeof value === 'string') {
      deps.push({
        name,
        ecosystem: 'pypi',
        specifier: value,
        source: `${source} [tool.poetry.dependencies]`,
      });
    } else {
      deps.push({
        name,
        ecosystem: 'pypi',
        specifier: value.version,
        extras: value.extras,
        source: `${source} [tool.poetry.dependencies]`,
      });
    }
  }

  return deps;
}
