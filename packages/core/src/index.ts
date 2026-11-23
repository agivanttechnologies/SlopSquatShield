// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
export type { Ecosystem, DependencyConflict, ExtractedDependency } from './extractors/types.js';
export { extractNpmDeps, isLocalNpmSpecifier } from './extractors/npm.js';
export { excludeLocalPackages, packageJsonName } from './scan/local-packages.js';
export { applyLockfilePin } from './scan/lockfile-pin.js';
export {
  classifyInstallCommand,
  type ClassifyInstallOptions,
  type InstallCommandClassification,
  type ManifestInstall,
  type ManifestInstallTool,
} from './extractors/install-command.js';
export {
  collectManifestInstall,
  type CollectLimits,
  type CollectedManifests,
  type ManifestReader,
} from './scan/manifest-install.js';
export {
  checkInstallCommand,
  type InstallCheckOptions,
  type InstallCheckResult,
} from './scan/check-install-command.js';
export { extractMavenDeps, type PomInput } from './extractors/maven.js';
export { extractInstallCommandDeps } from './extractors/install-command.js';
export { extractMarkdownInstallCommandDeps } from './extractors/markdown.js';
export { getDepsDevFacts, type DepsDevSystem, type DepsDevFacts } from './registry/deps-dev.js';
export { getNpmRegistryFacts, type NpmRegistryFacts } from './registry/npm.js';
export { getPyPiRegistryFacts, type PyPiRegistryFacts } from './registry/pypi.js';
export { findOnPath } from './exec/find-on-path.js';
export { getMavenCentralFacts, type MavenCentralFacts } from './registry/maven-central.js';
export { proxyFetch } from './registry/proxy-fetch.js';
export { setUserAgent, getUserAgent } from './registry/user-agent.js';
export {
  type LockfilePin,
  type LockfileIndex,
  buildLockfileIndex,
  resolveViaLockfile,
} from './resolvers/types.js';
export {
  parseNpmLockfile,
  parsePoetryLock,
  parsePipfileLock,
  parseMavenDependencyTree,
  getMavenDependencyTreePins,
} from './resolvers/lockfile/index.js';
export {
  RegistryCache,
  DEFAULT_CACHE_TTLS,
  defaultCacheDbPath,
  type CacheFactType,
  type CacheTtls,
} from './cache/store.js';
export { MemoryCache } from './cache/memory.js';
export type { FactCache } from './cache/types.js';
export {
  type PackageFacts,
  type SignalType,
  type Signal,
  type Tier,
  type Verdict,
  type RuleThresholds,
  DEFAULT_RULE_THRESHOLDS,
  ESTABLISHED_WEEKLY_DOWNLOADS,
} from './rules/types.js';
export { evaluatePackage, type EvaluateOptions } from './rules/engine.js';
export { describeVerdict } from './rules/describe.js';
export { findSimilarPopularPackage, type SimilarityMatch } from './rules/similarity.js';
export {
  isExpectedPrivate,
  type PrivateScopeConfig,
} from './rules/dependency-confusion.js';
export { POPULAR_NPM_PACKAGES } from './rules/popular-packages/npm.js';
export { POPULAR_PYPI_PACKAGES } from './rules/popular-packages/pypi.js';
export { POPULAR_MAVEN_COORDINATES } from './rules/popular-packages/maven.js';
export { parseAllowlist, isAllowlisted, appendToAllowlist } from './allowlist/index.js';
export {
  resolveVerdict,
  type ResolveVerdictOptions,
  type ResolveVerdictResult,
} from './scan/resolve-verdict.js';
export {
  createScanLimit,
  DEFAULT_SCAN_CONCURRENCY,
  scanDependencies,
  type ScanLimit,
  type ScanTarget,
  type ScanResult,
  type ScanDependenciesOptions,
  type UnreachableEntry,
} from './scan/scan-dependencies.js';
export { describeUnreachable } from './scan/unreachable-cause.js';
export { CREDIT } from './credit.js';
export { EXIT_CODES, type ExitCode, computeExitCode } from './scan/exit-codes.js';
export { ManifestParseError } from './scan/manifest-error.js';
export {
  CONFIG_FILE_NAME,
  PACKAGE_JSON_CONFIG_KEY,
  parseConfig,
  parsePackageJsonConfig,
  resolveConfig,
  type ResolvedConfig,
  type SlopSquatConfig,
} from './config/index.js';
export {
  assertWellFormedPom,
  extractDependenciesFromManifest,
  isSupportedManifest,
  SUPPORTED_MANIFEST_NAMES,
  type SupportedManifestName,
} from './scan/extract-manifest.js';
export {
  runHookCheck,
  type HookCheckInput,
  type HookDecision,
  type HookCheckResult,
} from './hooks/run-hook-check.js';
export {
  extractPythonDeps,
  extractPipfileDeps,
  extractPyprojectDeps,
  extractRequirementsTxtDeps,
  parseRequirementString,
  FALLBACK_IMPORT_TABLE,
  getActiveEnvPackageDistributions,
  resolvePythonImport,
  type PythonImportResolution,
  type PythonImportResolutionSource,
} from './extractors/python/index.js';
