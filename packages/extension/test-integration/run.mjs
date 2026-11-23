// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
// Launches a real VS Code (downloaded by @vscode/test-electron), loads this extension into it,
// and runs ./suite.cjs inside the extension host. Not part of `npm test`: it needs a display
// (use `xvfb-run -a` on a headless Linux box) and downloads an editor build on first run.
//
//   node test-integration/run.mjs            # latest stable
//   VSCODE_VERSION=1.85.0 node test-integration/run.mjs
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));

// A throwaway workspace holding one manifest with a hallucinated dependency and a kept one.
const workspace = mkdtempSync(join(tmpdir(), 'ssg-ext-itest-'));
writeFileSync(
  join(workspace, 'package.json'),
  `${JSON.stringify(
    { name: 'itest', dependencies: { 'zz-ghost-pkg': '^1.0.0', 'zz-kept-pkg': '^2.0.0' } },
    null,
    2,
  )}\n`,
);

try {
  await runTests({
    version: process.env.VSCODE_VERSION ?? 'stable',
    extensionDevelopmentPath: resolve(here, '..'),
    extensionTestsPath: resolve(here, 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust'],
    extensionTestsEnv: { SSG_ITEST_WORKSPACE: workspace },
  });
} catch (err) {
  console.error(`Integration tests failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
