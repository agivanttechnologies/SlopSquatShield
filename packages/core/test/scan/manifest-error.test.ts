// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { extractDependenciesFromManifest } from '../../src/scan/extract-manifest.js';
import { locateJsonError } from '../../src/scan/json-error.js';
import { ManifestParseError, offsetToLineColumn } from '../../src/scan/manifest-error.js';

describe('offsetToLineColumn', () => {
  it('is 1-based and counts lines by \\n', () => {
    expect(offsetToLineColumn('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    expect(offsetToLineColumn('ab\ncd', 99)).toEqual({ line: 2, column: 3 });
  });
});

describe('locateJsonError', () => {
  it.each([
    ['trailing comma', '{ "a": 1, }', 10],
    ['missing value', '{\n "a": }', 8],
    ['unterminated object (end of input)', '{ "dependencies": { "a": "1"', 28],
    ['unterminated string', '{ "a": "oops', 12],
    ['single-quoted key', "{ 'a': 1 }", 2],
    ['stray content after the value', '{} x', 3],
  ])('pinpoints %s', (_label, text, offset) => {
    expect(locateJsonError(text)?.offset).toBe(offset);
  });

  it.each([
    '{}',
    '[]',
    '{ "a": [1, 2.5e3, -0, true, false, null, "x\\"y"], "b": { "c": {} } }',
    '  \n{"a":1}\n',
  ])('finds no fault in valid JSON %j', (text) => {
    expect(locateJsonError(text)).toBeUndefined();
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe('extractDependenciesFromManifest — malformed manifests (NFR-3.3)', () => {
  function failure(path: string, content: string): ManifestParseError {
    try {
      extractDependenciesFromManifest(path, content);
    } catch (err) {
      return err as ManifestParseError;
    }
    throw new Error('expected a ManifestParseError');
  }

  it('package.json: a located ManifestParseError, not a raw SyntaxError', () => {
    const err = failure('/repo/package.json', '{\n  "dependencies": {\n    "a": "1",\n  }\n}');
    expect(err).toBeInstanceOf(ManifestParseError);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err.file).toBe('/repo/package.json');
    expect([err.line, err.column]).toEqual([4, 3]);
    expect(err.message).toMatch(/^\/repo\/package\.json:4:3: /);
  });

  it('package.json: truncated input points at the end', () => {
    const err = failure('package.json', '{ "dependencies": { "a": ');
    expect(err.line).toBe(1);
    expect(err.reason).toMatch(/end of JSON input/i);
  });

  it('pyproject.toml: carries the TOML parser line and column', () => {
    const err = failure('pyproject.toml', '[project\ndependencies = [');
    expect(err).toBeInstanceOf(ManifestParseError);
    expect(err.line).toBeGreaterThanOrEqual(1);
    expect(err.column).toBeGreaterThanOrEqual(1);
    expect(err.message).toContain('pyproject.toml:');
    expect(err.reason).not.toContain('\n');
  });

  it('Pipfile: also located', () => {
    expect(failure('Pipfile', '[packages\nrequests = "*"')).toBeInstanceOf(ManifestParseError);
  });

  it('pom.xml: a POM fast-xml-parser would silently misread is rejected with a position', () => {
    const err = failure('pom.xml', '<project><dependencies><dependency><groupId>a</groupId>');
    expect(err).toBeInstanceOf(ManifestParseError);
    expect(err.line).toBe(1);
    expect(err.file).toBe('pom.xml');
    expect(err.reason).toBe(
      'Malformed XML: unclosed element(s) project > dependencies > dependency',
    );
  });

  it('still parses well-formed manifests, and requirements.txt never throws', () => {
    expect(
      extractDependenciesFromManifest('package.json', '{"dependencies":{"a":"1"}}'),
    ).toHaveLength(1);
    expect(
      extractDependenciesFromManifest('requirements.txt', '\x00\x01 garbage ((( \n===\nflask'),
    ).toEqual(expect.any(Array));
  });
});
