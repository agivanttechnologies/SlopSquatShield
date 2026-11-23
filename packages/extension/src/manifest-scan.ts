// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import {
  type Ecosystem,
  type ExtractedDependency,
  type FactCache,
  ManifestParseError,
  POPULAR_MAVEN_COORDINATES,
  POPULAR_NPM_PACKAGES,
  POPULAR_PYPI_PACKAGES,
  type ScanLimit,
  describeUnreachable,
  extractDependenciesFromManifest,
  parseAllowlist,
  resolveConfig,
  scanDependencies,
} from '@slopsquatshield/core';
import type { Finding } from './findings.js';
import { locateDependency } from './locate.js';
import { severityFor } from './severity.js';
import type { Range } from './text.js';

export interface ScanManifestOptions {
  fileName: string;
  text: string;
  /** Contents of the workspace's `.slopsquatshield`, if any (parsed by core, FR-5.2). */
  allowlistText?: string;
  cache: FactCache;
  /** The project's config files' contents, if present (FR-4.1/FR-6.1), resolved by core. */
  configInputs?: Parameters<typeof resolveConfig>[0];
  /** Called when the config was present but unusable and defaults were used instead. */
  onConfigWarning?: (message: string) => void;
  /** Injectable for tests so nothing touches the real network. */
  fetchImpl?: typeof fetch;
  /** One limit shared by every manifest being scanned, so a workspace scan is not a burst. */
  limit?: ScanLimit;
}

const START_OF_FILE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

function dedupe(deps: ExtractedDependency[]): Array<{ identifier: string; ecosystem: Ecosystem }> {
  const seen = new Map<string, { identifier: string; ecosystem: Ecosystem }>();
  for (const dep of deps)
    seen.set(`${dep.ecosystem}:${dep.name}`, {
      identifier: dep.name,
      ecosystem: dep.ecosystem,
    });
  return [...seen.values()];
}

/**
 * The extension's whole detection path for one manifest: core extracts, core scans, core
 * judges — this file only wires them together and attaches editor ranges. No rule logic lives
 * here (FR-19.1/19.4; "one engine, thin adapters").
 *
 * Never throws: a manifest that won't parse becomes one Information finding at the error's
 * position (NFR-3.3), and registry failures become Information findings (NFR-3.1).
 */
export async function scanManifest(options: ScanManifestOptions): Promise<Finding[]> {
  const { fileName, text } = options;

  let deps: ExtractedDependency[];
  try {
    deps = extractDependenciesFromManifest(fileName, text);
  } catch (err) {
    if (err instanceof ManifestParseError) {
      const at = { line: Math.max(0, err.line - 1), character: Math.max(0, err.column - 1) };
      return [
        {
          fileName,
          identifier: '',
          ecosystem: undefined,
          kind: 'parse-error',
          severity: severityFor('parse-error'),
          message: `Could not read this manifest: ${err.reason}`,
          range: { start: at, end: { line: at.line, character: at.character + 1 } },
          signals: [],
        },
      ];
    }
    throw err;
  }

  const targets = dedupe(deps);
  if (targets.length === 0) return [];

  const allowlist =
    options.allowlistText === undefined ? undefined : parseAllowlist(options.allowlistText);
  const resolved = resolveConfig(options.configInputs ?? {});
  if (resolved.warning) options.onConfigWarning?.(resolved.warning);

  const { verdicts, unreachable } = await scanDependencies(targets, {
    allowlist,
    thresholds: resolved.config.thresholds,
    privateScope: resolved.config.privateScope,
    cache: options.cache,
    fetchImpl: options.fetchImpl,
    limit: options.limit,
    popularPackagesByEcosystem: {
      npm: POPULAR_NPM_PACKAGES,
      pypi: POPULAR_PYPI_PACKAGES,
      maven: POPULAR_MAVEN_COORDINATES,
    },
  });

  const findings: Finding[] = [];
  // An npm alias (`"lodash": "npm:real-pkg@1"`) is checked as `real-pkg` but declared as `lodash`.
  const declaredAs = new Map<string, string>();
  for (const dep of deps) if (dep.alias !== undefined) declaredAs.set(dep.name, dep.alias);
  const where = (identifier: string) =>
    locateDependency(fileName, text, declaredAs.get(identifier) ?? identifier);

  for (const verdict of verdicts) {
    if (verdict.tier === 'CLEAN') continue;
    const kind = verdict.tier === 'BLOCK' ? 'block' : 'warn';
    const location = where(verdict.identifier);
    findings.push({
      fileName,
      identifier: verdict.identifier,
      ecosystem: verdict.ecosystem,
      kind,
      severity: severityFor(kind),
      // The Problems list shows only the message, file and line — so the message names the package.
      message: `${verdict.identifier}: ${verdict.reason}`,
      range: location?.range ?? START_OF_FILE,
      signals: verdict.signals.map((s) => s.type),
      // Carried by a look-alike signal, or by a non-existence one whose name is a typo of a popular
      // package (`reqeusts` → `requests`).
      suggestion: verdict.signals.find((s) => s.suggestion)?.suggestion,
      removeLines: location?.lines,
    });
  }

  for (const entry of unreachable) {
    findings.push({
      fileName,
      identifier: entry.identifier,
      ecosystem: entry.ecosystem,
      kind: 'unreachable',
      severity: severityFor('unreachable'),
      message: `${entry.identifier}: Not verified, the registry was unreachable (${describeUnreachable(entry.error)}). Not a finding.`,
      range: where(entry.identifier)?.range ?? START_OF_FILE,
      signals: [],
    });
  }

  return findings;
}
