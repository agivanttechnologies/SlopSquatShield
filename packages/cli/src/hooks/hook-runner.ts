// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  type HookCheckResult,
  POPULAR_MAVEN_COORDINATES,
  POPULAR_NPM_PACKAGES,
  POPULAR_PYPI_PACKAGES,
  runHookCheck,
} from '@slopsquatshield/core';
import { nodeManifestReader } from '../manifest-io.js';
import { loadProjectContext } from '../project-context.js';
import type { HookHost } from './hook-command.js';
import { type HookInput, parseHookInput } from './hook-input.js';
import { LazyRegistryCache } from './lazy-cache.js';

export interface RunHookCheckFromStdinOptions {
  /** Override for `RegistryCache`'s DB path — mainly for tests; defaults to the OS cache dir. */
  cachePath?: string;
  /** Override for the raw stdin text — mainly for tests; defaults to reading process.stdin. */
  stdinText?: string;
  /** Which host is calling — selects the stdin shape. Defaults to Claude Code's (shared by Cursor/Codex). */
  host?: HookHost;
  /** Override for the allowlist's project root — mainly for tests; defaults to process.cwd(). */
  cwd?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * The one shared code path every agent-hook adapter calls (FR-12.4) —
 * `hooks/claude-code.ts` and `hooks/cursor.ts` (and `hooks/codex.ts`/`hooks/antigravity.ts`)
 * differ only in how they format the `HookCheckResult` this returns, since they
 * all call one shared `runHookCheck()` from core. This function is
 * the CLI-side half: parsing the shared stdin shape (identical across every host, FR-12.4's
 * own example) and wiring in the cache/allowlist/popular-package options the same way
 * `commands/scan.ts` and `commands/install-wrapper.ts` already do, so behavior never drifts
 * between surfaces.
 */
export async function runHookCheckFromStdin(
  options: RunHookCheckFromStdinOptions = {},
): Promise<HookCheckResult & Pick<HookInput, 'caller'>> {
  const raw = options.stdinText ?? (await readStdin());
  const parsed = parseHookInput(options.host ?? 'claude-code', raw);
  if (!parsed) {
    // Unparseable payload: fail open (NFR-3.1) — a host bug must never stall or block the agent.
    return {
      decision: 'allow',
      reason: 'could not parse the hook input — allowed without checking',
      verdicts: [],
      unreachable: [],
    };
  }
  const command = parsed.command;

  // Which project's allowlist applies: an explicit override, else the host-reported cwd, else
  // ours. The host's cwd is only trusted if this process can see it — under WSL with a Windows
  // `node.exe`, a POSIX path like /home/me/proj doesn't exist from here, so fall back.
  const hostCwd = parsed.cwd && existsSync(parsed.cwd) ? parsed.cwd : undefined;
  const cwd = options.cwd ?? hostCwd ?? process.cwd();
  const { allowlist, config, configWarning } = loadProjectContext(cwd);
  if (configWarning) process.stderr.write(`slopsquatshield: ${configWarning}\n`);

  // Lazy: a non-install command never needs the cache, so don't open it (or load SQLite) for it.
  const cache = new LazyRegistryCache(options.cachePath);
  try {
    const result = await runHookCheck(
      { toolName: parsed.toolName, command },
      {
        allowlist,
        thresholds: config.thresholds,
        privateScope: config.privateScope,
        // A bare `npm install` / `npm ci` / `pip install -r` names nothing on the command line,
        // so the check reads the project's manifests: where, and how, is decided in core.
        cwd,
        homeDir: homedir(),
        reader: nodeManifestReader,
        cache,
        popularPackagesByEcosystem: {
          npm: POPULAR_NPM_PACKAGES,
          pypi: POPULAR_PYPI_PACKAGES,
          maven: POPULAR_MAVEN_COORDINATES,
        },
      },
    );
    return { ...result, ...(parsed.caller ? { caller: parsed.caller } : {}) };
  } finally {
    cache.close();
  }
}
