// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  extractDependenciesFromManifest,
  isSupportedManifest,
} from '../../src/scan/extract-manifest.js';
import { ManifestParseError } from '../../src/scan/manifest-error.js';

describe('extractDependenciesFromManifest', () => {
  it('extracts package.json deps, folding the path into the source', () => {
    const deps = extractDependenciesFromManifest(
      '/repo/package.json',
      JSON.stringify({ dependencies: { 'left-pad': '1.0.0' } }),
    );
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ name: 'left-pad', ecosystem: 'npm' });
    expect(deps[0].source).toBe('/repo/package.json [dependencies]');
  });

  it('extracts requirements.txt deps', () => {
    const deps = extractDependenciesFromManifest('requirements.txt', 'requests==2.0\nflask\n');
    expect(deps.map((d) => d.name).sort()).toEqual(['flask', 'requests']);
    expect(deps.every((d) => d.ecosystem === 'pypi')).toBe(true);
  });

  it('extracts pom.xml deps as groupId:artifactId', () => {
    const pom =
      '<project><dependencies><dependency><groupId>org.apache.commons</groupId><artifactId>commons-lang3</artifactId><version>3.12.0</version></dependency></dependencies></project>';
    const deps = extractDependenciesFromManifest('C:\\proj\\pom.xml', pom);
    expect(deps.map((d) => d.name)).toEqual(['org.apache.commons:commons-lang3']);
  });

  it('dispatches on the file name for both path separators', () => {
    expect(extractDependenciesFromManifest('C:\\a\\b\\requirements.txt', 'flask\n')).toHaveLength(
      1,
    );
    expect(extractDependenciesFromManifest('/a/b/requirements.txt', 'flask\n')).toHaveLength(1);
  });

  it('returns [] for an unsupported file name', () => {
    expect(extractDependenciesFromManifest('README.md', 'npm install foo')).toEqual([]);
  });

  it('throws a located ManifestParseError (not a raw SyntaxError) for invalid package.json', () => {
    expect(() => extractDependenciesFromManifest('package.json', '{ nope')).toThrow(
      ManifestParseError,
    );
  });
});

describe('isSupportedManifest', () => {
  it.each(['package.json', '/x/pom.xml', 'C:\\x\\Pipfile', 'pyproject.toml', 'requirements.txt'])(
    'accepts %s',
    (p) => expect(isSupportedManifest(p)).toBe(true),
  );
  it.each(['package-lock.json', 'README.md', 'requirements-dev.txt'])('rejects %s', (p) =>
    expect(isSupportedManifest(p)).toBe(false),
  );
});
