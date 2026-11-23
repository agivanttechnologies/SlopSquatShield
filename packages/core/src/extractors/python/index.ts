// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { ExtractedDependency } from '../types.js';
import { extractPipfileDeps } from './pipfile.js';
import { extractPyprojectDeps } from './pyproject.js';
import { extractRequirementsTxtDeps } from './requirements.js';

export { extractPipfileDeps } from './pipfile.js';
export { extractPyprojectDeps } from './pyproject.js';
export { extractRequirementsTxtDeps, parseRequirementString } from './requirements.js';
export {
  FALLBACK_IMPORT_TABLE,
  getActiveEnvPackageDistributions,
  resolvePythonImport,
  type PythonImportResolution,
  type PythonImportResolutionSource,
} from './import-resolution.js';

/** Routes a Python manifest to the matching extractor by filename (FR-1.2). */
export function extractPythonDeps(filename: string, content: string): ExtractedDependency[] {
  const base = filename.split(/[\\/]/).pop() ?? filename;

  if (base === 'Pipfile') return extractPipfileDeps(content, filename);
  if (base === 'pyproject.toml') return extractPyprojectDeps(content, filename);
  if (base.endsWith('.txt')) return extractRequirementsTxtDeps(content, filename);

  throw new Error(`Unrecognized Python manifest: ${filename}`);
}
