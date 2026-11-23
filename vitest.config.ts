// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `vscode` only exists inside an editor; the extension's tests run against an in-memory fake.
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./packages/extension/test/fake-vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    // Fails any test that makes an HTTP request no MSW handler matched (see the file).
    setupFiles: ['./vitest.setup.ts'],
  },
});
