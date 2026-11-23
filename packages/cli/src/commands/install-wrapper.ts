// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, resolve } from 'node:path';
import {
  EXIT_CODES,
  POPULAR_MAVEN_COORDINATES,
  POPULAR_NPM_PACKAGES,
  POPULAR_PYPI_PACKAGES,
  checkInstallCommand,
  classifyInstallCommand,
} from '@slopsquatshield/core';
import crossSpawn from 'cross-spawn';
import { formatInstallReport } from '../format/install.js';
import { type Style, createStyle } from '../format/style.js';
import { LazyRegistryCache } from '../hooks/lazy-cache.js';
import { SHIM_DIR_ENV } from '../install/launcher.js';
import { nodeManifestReader } from '../manifest-io.js';
import { loadProjectContext } from '../project-context.js';

export type InstallTool = 'npm' | 'pip' | 'mvn';

export interface RunInstallWrapperOptions {
  /** Override for `RegistryCache`'s DB path — mainly for tests; defaults to the OS cache dir. */
  cachePath?: string;
  /** Override for the project directory whose allowlist/config apply — mainly for tests. */
  cwd?: string;
  /** Override for the real binary actually invoked on passthrough — mainly for tests. */
  spawnImpl?: typeof crossSpawn;
  /** How the stderr report looks; defaults to what stderr supports. */
  style?: Style;
}

const POPULAR_BY_ECOSYSTEM = {
  npm: POPULAR_NPM_PACKAGES,
  pypi: POPULAR_PYPI_PACKAGES,
  maven: POPULAR_MAVEN_COORDINATES,
};

/**
 * Forwards to the real package manager via `cross-spawn` rather than
 * `node:child_process.spawn(..., { shell: true })` — Node's own `DEP0190` deprecation
 * flags that combination as an escaping hazard (args get concatenated into a shell
 * command line, not safely quoted). `cross-spawn` resolves Windows's `.cmd`/`.bat` shims
 * (which `npm`/`pip`/`mvn` commonly are there) without ever handing arguments to a shell.
 */
/**
 * PATH with the CI shim dir (`init --ci`) removed. The shim dir sits first on PATH, so
 * without this the spawn below would resolve `npm` to the shim again and recurse forever.
 */
export function pathWithoutShimDir(env: NodeJS.ProcessEnv): string | undefined {
  const shimDir = env[SHIM_DIR_ENV];
  const path = env.PATH ?? env.Path;
  if (!shimDir || !path) return path;
  const skip = resolve(shimDir);
  return path
    .split(delimiter)
    .filter((dir) => dir === '' || resolve(dir) !== skip)
    .join(delimiter);
}

function forward(tool: InstallTool, args: string[], spawnImpl: typeof crossSpawn): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const env = { ...process.env };
    const cleaned = pathWithoutShimDir(env);
    if (cleaned !== undefined) {
      env.PATH = cleaned;
      if (env.Path !== undefined) env.Path = cleaned;
    }
    const child: ChildProcess = spawnImpl(tool, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolvePromise(code ?? (signal ? 1 : 0)));
  });
}

/**
 * The safe-install wrapper (FR-9): `slopsquatshield npm|pip|mvn <args>` verifies an
 * install-shaped command before ever forwarding it to the real package manager.
 * Detection is core's `checkInstallCommand` (FR-1.4): it verifies the packages the command
 * **names**, and — for an install driven by a manifest (`npm install`, `npm ci`,
 * `pip install -r requirements.txt`, `mvn test`, …) — the packages the project's manifest lists.
 * A command that installs nothing (`npm --version`, `npm test`) is recognised by a local regex
 * match alone and passes straight through with no file or registry access (FR-9.4), so the
 * passthrough overhead stays negligible.
 *
 * A BLOCK-tier finding prints what was blocked and why (`format/install.ts`) and returns without
 * ever spawning the real package manager (FR-9.2) — the flagged install never reaches disk.
 * WARN-only findings print to stderr but still proceed (FR-9.3): WARN never blocks a
 * non-interactive install.
 */
export async function runInstallWrapper(
  tool: InstallTool,
  args: string[],
  options: RunInstallWrapperOptions = {},
): Promise<number> {
  const spawnImpl = options.spawnImpl ?? crossSpawn;
  const commandText = `${tool} ${args.join(' ')}`;
  const cwd = options.cwd ?? process.cwd();
  const home = homedir();

  // Cheap, I/O-free look first: a command that installs nothing (`npm --version`, `npm test`)
  // passes straight through without touching the filesystem or the network (FR-9.4).
  const classified = classifyInstallCommand(commandText, {
    includeXmlBlocks: false,
    cwd,
    homeDir: home,
  });
  if (classified.named.length === 0 && classified.manifestInstalls.length === 0) {
    return forward(tool, args, spawnImpl);
  }

  // The same allowlist and configuration every other surface reads (FR-5.2).
  const { allowlist, config, configWarning } = loadProjectContext(cwd);
  if (configWarning) process.stderr.write(`slopsquatshield: ${configWarning}\n`);

  const cache = new LazyRegistryCache(options.cachePath);
  let result: Awaited<ReturnType<typeof checkInstallCommand>>;
  try {
    // Checks the packages the command names *and*, for `npm install` / `npm ci` / `pip install -r`
    // / `mvn test`, the ones the project's manifest lists — an agent's usual route is to edit
    // package.json and then run a bare install.
    result = await checkInstallCommand(commandText, {
      cwd,
      homeDir: home,
      reader: nodeManifestReader,
      allowlist,
      thresholds: config.thresholds,
      privateScope: config.privateScope,
      cache,
      popularPackagesByEcosystem: POPULAR_BY_ECOSYSTEM,
    });
  } finally {
    cache.close();
  }

  const report = formatInstallReport(
    commandText,
    result,
    options.style ?? createStyle(process.stderr),
  );
  if (report) process.stderr.write(`${report}\n`);
  if (result.verdicts.some((v) => v.tier === 'BLOCK')) return EXIT_CODES.HALLUCINATION;

  return forward(tool, args, spawnImpl);
}
