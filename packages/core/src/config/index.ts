// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { PrivateScopeConfig } from '../rules/dependency-confusion.js';
import type { RuleThresholds } from '../rules/types.js';
import { ManifestParseError, offsetToLineColumn } from '../scan/manifest-error.js';
import { parseJsonLocated } from '../scan/parse-json.js';

/**
 * Per-project configuration (FR-4.1 thresholds, FR-6.1 private scopes). It maps straight onto
 * the options the rule engine already accepts — this module only reads and validates; no rule
 * logic lives here. Validated by hand rather than with a schema library so every problem can be
 * reported at the exact `file:line:column` of the offending key (NFR-3.3).
 */
export interface SlopSquatConfig {
  thresholds?: Partial<RuleThresholds>;
  privateScope?: PrivateScopeConfig;
}

/** The dedicated config file name, looked up at the project root. */
export const CONFIG_FILE_NAME = '.slopsquatshieldrc';
/** The `package.json` key that can hold the same object instead. */
export const PACKAGE_JSON_CONFIG_KEY = 'slopsquatshield';

const THRESHOLD_KEYS = ['minAgeDays', 'minWeeklyDownloads', 'maxNameSimilarityDistance'] as const;
const PRIVATE_SCOPE_KEYS = ['npm', 'pypi', 'maven'] as const;
const TOP_LEVEL_KEYS = ['thresholds', 'privateScopes'] as const;

/** Offset of the last key in `path`, found by scanning for each quoted key in turn. */
function locateKey(text: string, path: string[]): number {
  let offset = 0;
  for (const key of path) {
    const at = text.indexOf(`"${key}"`, offset);
    if (at === -1) break;
    offset = at;
  }
  return offset;
}

class Reporter {
  constructor(
    private readonly file: string,
    private readonly text: string,
    private readonly base: string[],
  ) {}

  fail(path: string[], reason: string): never {
    const offset = locateKey(this.text, [...this.base, ...path]);
    const { line, column } = offsetToLineColumn(this.text, offset);
    throw new ManifestParseError(this.file, line, column, reason);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(
  report: Reporter,
  path: string[],
  object: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      report.fail([...path, key], `Unknown key "${key}" (allowed: ${allowed.join(', ')})`);
    }
  }
}

function stringArray(report: Reporter, path: string[], value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim() === '')) {
    report.fail(path, `"${path.join('.')}" must be an array of non-empty strings`);
  }
  return (value as string[]).map((v) => v.trim());
}

function validateThresholds(report: Reporter, value: unknown): Partial<RuleThresholds> {
  if (!isPlainObject(value)) report.fail(['thresholds'], '"thresholds" must be an object');
  const thresholds = value as Record<string, unknown>;
  checkKeys(report, ['thresholds'], thresholds, THRESHOLD_KEYS);

  const parsed: Partial<RuleThresholds> = {};
  for (const key of THRESHOLD_KEYS) {
    const entry = thresholds[key];
    if (entry === undefined) continue;
    const wholeNumber = key === 'maxNameSimilarityDistance';
    const valid =
      typeof entry === 'number' &&
      Number.isFinite(entry) &&
      entry >= 0 &&
      (!wholeNumber || Number.isInteger(entry));
    if (!valid) {
      report.fail(
        ['thresholds', key],
        `"thresholds.${key}" must be a ${wholeNumber ? 'whole number' : 'number'} of 0 or more`,
      );
    }
    parsed[key] = entry as number;
  }
  return parsed;
}

function validatePrivateScopes(report: Reporter, value: unknown): PrivateScopeConfig {
  if (!isPlainObject(value)) report.fail(['privateScopes'], '"privateScopes" must be an object');
  const scopes = value as Record<string, unknown>;
  checkKeys(report, ['privateScopes'], scopes, PRIVATE_SCOPE_KEYS);
  const privateScope: PrivateScopeConfig = {};

  if (scopes.npm !== undefined) {
    const npm = stringArray(report, ['privateScopes', 'npm'], scopes.npm);
    for (const scope of npm) {
      if (!scope.startsWith('@') || scope.includes('/')) {
        report.fail(['privateScopes', 'npm'], `npm scope "${scope}" must look like "@acme"`);
      }
    }
    privateScope.npmScopes = npm;
  }

  if (scopes.pypi !== undefined) {
    if (typeof scopes.pypi !== 'string' || scopes.pypi === '') {
      report.fail(
        ['privateScopes', 'pypi'],
        '"privateScopes.pypi" must be a regular-expression string',
      );
    }
    try {
      privateScope.pypiIndexPattern = new RegExp(scopes.pypi as string);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      report.fail(
        ['privateScopes', 'pypi'],
        `"privateScopes.pypi" is not a valid regular expression: ${why}`,
      );
    }
  }

  if (scopes.maven !== undefined) {
    privateScope.mavenGroupPrefixes = stringArray(report, ['privateScopes', 'maven'], scopes.maven);
  }
  return privateScope;
}

function validate(object: unknown, report: Reporter): SlopSquatConfig {
  if (!isPlainObject(object)) report.fail([], 'The configuration must be a JSON object');
  const root = object as Record<string, unknown>;
  checkKeys(report, [], root, TOP_LEVEL_KEYS);

  const config: SlopSquatConfig = {};
  if (root.thresholds !== undefined)
    config.thresholds = validateThresholds(report, root.thresholds);
  if (root.privateScopes !== undefined) {
    config.privateScope = validatePrivateScopes(report, root.privateScopes);
  }
  return config;
}

/** Parses a `.slopsquatshieldrc` file. Throws a located `ManifestParseError` on any problem. */
export function parseConfig(text: string, fileName = CONFIG_FILE_NAME): SlopSquatConfig {
  return validate(parseJsonLocated(fileName, text), new Reporter(fileName, text, []));
}

/**
 * Reads the `slopsquatshield` key out of a `package.json`. Returns `undefined` when the key is
 * absent — and for unparseable input, since reporting a broken `package.json` is the manifest
 * scan's job, not this function's.
 */
export function parsePackageJsonConfig(
  text: string,
  fileName = 'package.json',
): SlopSquatConfig | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed) || parsed[PACKAGE_JSON_CONFIG_KEY] === undefined) return undefined;
  return validate(
    parsed[PACKAGE_JSON_CONFIG_KEY],
    new Reporter(fileName, text, [PACKAGE_JSON_CONFIG_KEY]),
  );
}

export interface ResolvedConfig {
  config: SlopSquatConfig;
  /** Which file it came from, for messages. */
  source?: string;
  /** Set when the config was present but unusable: the run continues on defaults (NFR-3.1). */
  warning?: string;
}

/**
 * Picks the project's config from file contents the caller already read — `.slopsquatshieldrc`
 * wins over a `package.json` key. A broken config never stops a scan or a hook: the result is the
 * defaults plus a `warning` naming `file:line:column` (fail open on a configuration mistake, but
 * never silently).
 */
export function resolveConfig(inputs: {
  rc?: { fileName: string; text: string };
  packageJson?: { fileName: string; text: string };
}): ResolvedConfig {
  try {
    if (inputs.rc) {
      return {
        config: parseConfig(inputs.rc.text, inputs.rc.fileName),
        source: inputs.rc.fileName,
      };
    }
    if (inputs.packageJson) {
      const config = parsePackageJsonConfig(inputs.packageJson.text, inputs.packageJson.fileName);
      if (config) return { config, source: inputs.packageJson.fileName };
    }
    return { config: {} };
  } catch (err) {
    if (err instanceof ManifestParseError) {
      return {
        config: {},
        warning: `Ignoring the SlopSquatShield configuration and using defaults — ${err.message}`,
      };
    }
    throw err;
  }
}
