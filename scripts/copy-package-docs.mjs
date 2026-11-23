// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
// `npm pack`/`publish` and `vsce package` only include files inside the package directory, but the
// README, LICENSE, NOTICE and THIRD_PARTY_NOTICES.md live at the repo root. Packing copies them in and
// removes the copies afterwards, so there is never a second committed copy to drift. Run from a
// package directory (npm does that). Name the files to copy after the mode; the default is the
// CLI's set. The extension keeps its own README and LICENSE and copies only NOTICE and the notices.
import { copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [mode, ...names] = process.argv.slice(2);
const files = names.length ? names : ['README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'];
const root = resolve(process.cwd(), '..', '..');
for (const name of files) {
  if (mode === 'copy') copyFileSync(join(root, name), join(process.cwd(), name));
  else if (mode === 'clean') rmSync(join(process.cwd(), name), { force: true });
  else throw new Error('usage: copy-package-docs.mjs copy|clean [file ...]');
}
