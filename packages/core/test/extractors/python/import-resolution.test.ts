// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_IMPORT_TABLE,
  getActiveEnvPackageDistributions,
  resolvePythonImport,
} from '../../../src/extractors/python/import-resolution.js';

describe('resolvePythonImport', () => {
  it('resolves cv2 via the fallback table when no active env is available', () => {
    const result = resolvePythonImport('cv2');
    expect(result).toEqual({
      importName: 'cv2',
      distribution: 'opencv-python',
      resolvedVia: 'fallback',
    });
  });

  it('prefers the active env mapping over the fallback table when both name the import', () => {
    const result = resolvePythonImport('cv2', { cv2: ['opencv-python-headless'] });
    expect(result).toEqual({
      importName: 'cv2',
      distribution: 'opencv-python-headless',
      resolvedVia: 'env',
    });
  });

  it('resolves an import only the active env knows about', () => {
    const result = resolvePythonImport('my_internal_pkg', { my_internal_pkg: ['my-internal-pkg'] });
    expect(result).toEqual({
      importName: 'my_internal_pkg',
      distribution: 'my-internal-pkg',
      resolvedVia: 'env',
    });
  });

  it('reports an unrecognized import as unresolved, never as a finding', () => {
    const result = resolvePythonImport('totally_unknown_import_xyz');
    expect(result).toEqual({ importName: 'totally_unknown_import_xyz', resolvedVia: 'unresolved' });
    expect(result.distribution).toBeUndefined();
  });

  it('the fallback table has at least 30 curated entries', () => {
    expect(Object.keys(FALLBACK_IMPORT_TABLE).length).toBeGreaterThanOrEqual(30);
  });
});

describe('getActiveEnvPackageDistributions', () => {
  it('fails open (empty mapping) when no such Python interpreter exists on PATH', async () => {
    const result = await getActiveEnvPackageDistributions(
      'definitely-not-a-real-python-binary-xyz',
    );
    expect(result).toEqual({});
  });
});
