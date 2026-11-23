// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  CONFIG_FILE_NAME,
  parseConfig,
  parsePackageJsonConfig,
  resolveConfig,
} from '../../src/config/index.js';
import { isExpectedPrivate } from '../../src/rules/dependency-confusion.js';
import { evaluatePackage } from '../../src/rules/engine.js';
import { ManifestParseError } from '../../src/scan/manifest-error.js';

const NOW = new Date('2026-10-01T00:00:00Z');

function failure(text: string): ManifestParseError {
  try {
    parseConfig(text);
  } catch (err) {
    return err as ManifestParseError;
  }
  throw new Error('expected a ManifestParseError');
}

describe('parseConfig', () => {
  it('accepts the documented example for all three ecosystems', () => {
    const config = parseConfig(`{
  "thresholds": { "minAgeDays": 30, "minWeeklyDownloads": 1000, "maxNameSimilarityDistance": 1 },
  "privateScopes": {
    "npm": ["@acme", "@acme-internal"],
    "pypi": "^acme-",
    "maven": ["com.acme", "com.acme.internal"]
  }
}`);

    expect(config.thresholds).toEqual({
      minAgeDays: 30,
      minWeeklyDownloads: 1000,
      maxNameSimilarityDistance: 1,
    });
    expect(config.privateScope?.npmScopes).toEqual(['@acme', '@acme-internal']);
    expect(config.privateScope?.pypiIndexPattern).toBeInstanceOf(RegExp);
    expect(config.privateScope?.pypiIndexPattern?.test('acme-utils')).toBe(true);
    expect(config.privateScope?.mavenGroupPrefixes).toEqual(['com.acme', 'com.acme.internal']);
  });

  it('an empty object is valid and changes nothing', () => {
    expect(parseConfig('{}')).toEqual({});
  });

  it('each section is optional and independent', () => {
    expect(parseConfig('{"thresholds":{"minAgeDays":7}}').privateScope).toBeUndefined();
    expect(parseConfig('{"privateScopes":{"maven":["com.x"]}}').thresholds).toBeUndefined();
  });

  describe('rejects mistakes with file:line:column, never a stack trace (NFR-3.3)', () => {
    it('invalid JSON', () => {
      const err = failure('{\n  "thresholds": {\n    "minAgeDays": 5,\n  }\n}');
      expect(err).toBeInstanceOf(ManifestParseError);
      expect(err.file).toBe(CONFIG_FILE_NAME);
      expect(err.line).toBe(4);
    });

    it('an unknown top-level key, pointing at it', () => {
      const err = failure('{\n  "thresholds": {},\n  "treshholds": {}\n}');
      expect(err.reason).toContain('Unknown key "treshholds"');
      expect(err.line).toBe(3);
    });

    it('an unknown threshold key', () => {
      const err = failure('{"thresholds": {"minAge": 3}}');
      expect(err.reason).toContain('Unknown key "minAge"');
      expect(err.reason).toContain('minAgeDays');
    });

    it.each([
      ['a string', '"14"'],
      ['a negative number', '-1'],
      ['null', 'null'],
    ])('a threshold that is %s', (_label, value) => {
      const err = failure(`{\n  "thresholds": {\n    "minAgeDays": ${value}\n  }\n}`);
      expect(err.reason).toContain('"thresholds.minAgeDays" must be a number of 0 or more');
      expect(err.line).toBe(3);
    });

    it('a fractional name-similarity distance', () => {
      expect(failure('{"thresholds":{"maxNameSimilarityDistance":1.5}}').reason).toContain(
        'whole number',
      );
    });

    it('a non-object root, thresholds, or privateScopes', () => {
      expect(failure('[]').reason).toContain('must be a JSON object');
      expect(failure('{"thresholds": 3}').reason).toContain('"thresholds" must be an object');
      expect(failure('{"privateScopes": []}').reason).toContain(
        '"privateScopes" must be an object',
      );
    });

    it('an npm scope without the @, or with a slash', () => {
      expect(failure('{"privateScopes":{"npm":["acme"]}}').reason).toContain('"@acme"');
      expect(failure('{"privateScopes":{"npm":["@acme/pkg"]}}').reason).toContain('"@acme"');
    });

    it('a pypi pattern that is not a valid regular expression', () => {
      const err = failure('{"privateScopes":{"pypi":"(unclosed"}}');
      expect(err.reason).toContain('not a valid regular expression');
    });

    it('a maven prefix list that is not strings', () => {
      expect(failure('{"privateScopes":{"maven":[1]}}').reason).toContain(
        'array of non-empty strings',
      );
    });
  });
});

describe('parsePackageJsonConfig', () => {
  it('reads the slopsquatshield key', () => {
    const config = parsePackageJsonConfig(
      JSON.stringify({ name: 'x', slopsquatshield: { thresholds: { minAgeDays: 3 } } }),
    );
    expect(config?.thresholds?.minAgeDays).toBe(3);
  });

  it('is undefined when the key is absent, or the file is not valid JSON', () => {
    expect(parsePackageJsonConfig('{"name":"x"}')).toBeUndefined();
    expect(parsePackageJsonConfig('{ broken')).toBeUndefined();
  });

  it('locates an error inside the key in package.json terms', () => {
    const text =
      '{\n  "name": "x",\n  "slopsquatshield": {\n    "thresholds": { "minAgeDays": "x" }\n  }\n}';
    try {
      parsePackageJsonConfig(text, '/p/package.json');
      throw new Error('expected failure');
    } catch (err) {
      const e = err as ManifestParseError;
      expect(e.file).toBe('/p/package.json');
      expect(e.line).toBe(4);
    }
  });
});

describe('resolveConfig', () => {
  const rc = (text: string) => ({ fileName: '/p/.slopsquatshieldrc', text });
  const pkg = (obj: unknown) => ({ fileName: '/p/package.json', text: JSON.stringify(obj) });

  it('no inputs → defaults, no warning', () => {
    expect(resolveConfig({})).toEqual({ config: {} });
  });

  it('.slopsquatshieldrc wins over a package.json key', () => {
    const resolved = resolveConfig({
      rc: rc('{"thresholds":{"minAgeDays":1}}'),
      packageJson: pkg({ slopsquatshield: { thresholds: { minAgeDays: 99 } } }),
    });
    expect(resolved.config.thresholds?.minAgeDays).toBe(1);
    expect(resolved.source).toBe('/p/.slopsquatshieldrc');
  });

  it('falls back to the package.json key', () => {
    const resolved = resolveConfig({
      packageJson: pkg({ slopsquatshield: { thresholds: { minAgeDays: 99 } } }),
    });
    expect(resolved.config.thresholds?.minAgeDays).toBe(99);
    expect(resolved.source).toBe('/p/package.json');
  });

  it('a broken config fails open to defaults WITH a located warning (NFR-3.1)', () => {
    const resolved = resolveConfig({ rc: rc('{"thresholds":{"minAgeDays":"x"}}') });
    expect(resolved.config).toEqual({});
    expect(resolved.warning).toContain('using defaults');
    expect(resolved.warning).toContain('/p/.slopsquatshieldrc:1:');
  });
});

describe('the parsed config actually drives the rule engine (FR-4.1 / FR-6.1)', () => {
  const young = {
    exists: true,
    firstPublishedAt: '2026-09-10T00:00:00Z',
    weeklyDownloads: 50_000,
    repoUrl: 'https://github.com/x/y',
  };

  it('a stricter minAgeDays turns a 21-day-old package from clean into a WARN', () => {
    const base = evaluatePackage('some-lib', 'npm', young, { now: () => NOW });
    expect(base.tier).toBe('CLEAN'); // 21 days old, default threshold is 14

    const { thresholds } = parseConfig('{"thresholds":{"minAgeDays":30}}');
    const strict = evaluatePackage('some-lib', 'npm', young, { now: () => NOW, thresholds });
    expect(strict.tier).toBe('WARN');
    expect(strict.signals.map((s) => s.type)).toContain('age');
  });

  it('a stricter weekly-downloads floor flags a modestly popular package', () => {
    const facts = { ...young, firstPublishedAt: '2015-01-01T00:00:00Z', weeklyDownloads: 800 };
    expect(evaluatePackage('lib', 'npm', facts, { now: () => NOW }).tier).toBe('CLEAN');

    const { thresholds } = parseConfig('{"thresholds":{"minWeeklyDownloads":5000}}');
    expect(evaluatePackage('lib', 'npm', facts, { now: () => NOW, thresholds }).tier).toBe('WARN');
  });

  it('declared private scopes mark names as expected-private for all three ecosystems', () => {
    const { privateScope } = parseConfig(
      '{"privateScopes":{"npm":["@acme"],"pypi":"^acme-","maven":["com.acme"]}}',
    );
    expect(privateScope).toBeDefined();
    const scope = privateScope ?? {};
    expect(isExpectedPrivate('@acme/ui', 'npm', scope)).toBe(true);
    expect(isExpectedPrivate('@other/ui', 'npm', scope)).toBe(false);
    expect(isExpectedPrivate('acme-utils', 'pypi', scope)).toBe(true);
    expect(isExpectedPrivate('requests', 'pypi', scope)).toBe(false);
    expect(isExpectedPrivate('com.acme.billing:core', 'maven', scope)).toBe(true);
    expect(isExpectedPrivate('com.acmeco:core', 'maven', scope)).toBe(false);
  });

  it('a private-scoped name that exists on the PUBLIC registry is a dependency-confusion BLOCK', () => {
    const { privateScope } = parseConfig('{"privateScopes":{"npm":["@acme"]}}');
    const verdict = evaluatePackage('@acme/internal-ui', 'npm', young, {
      now: () => NOW,
      privateScope,
    });
    expect(verdict.tier).toBe('BLOCK');
    expect(verdict.signals.map((s) => s.type)).toContain('private-registry-mismatch');
  });
});
