// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractMarkdownInstallCommandDeps } from '../../src/extractors/markdown.js';

const fixturePath = fileURLToPath(
  new URL('../fixtures/markdown/install-commands.md', import.meta.url),
);
const fixture = readFileSync(fixturePath, 'utf-8');

describe('extractMarkdownInstallCommandDeps', () => {
  it('extracts only the 5 real commands (fenced + inline), ignoring the 5 prose mentions', () => {
    const deps = extractMarkdownInstallCommandDeps(fixture);
    expect(deps).toHaveLength(5);
  });

  it('extracts commands from fenced code blocks, with and without a language tag', () => {
    const deps = extractMarkdownInstallCommandDeps(fixture);
    expect(deps.find((d) => d.name === 'express')).toMatchObject({ ecosystem: 'npm' });
    expect(
      deps.find((d) => d.name === 'com.fasterxml.jackson.core:jackson-databind'),
    ).toMatchObject({
      ecosystem: 'maven',
      specifier: '2.17.0',
    });
    expect(deps.find((d) => d.name === 'httpx')).toMatchObject({ ecosystem: 'pypi' });
  });

  it('extracts commands from inline code spans', () => {
    const deps = extractMarkdownInstallCommandDeps(fixture);
    expect(deps.find((d) => d.name === 'requests')).toMatchObject({ ecosystem: 'pypi' });
    expect(deps.find((d) => d.name === 'fastapi')).toMatchObject({ ecosystem: 'pypi' });
  });

  it('never extracts a package name that only appears in prose', () => {
    const deps = extractMarkdownInstallCommandDeps(fixture);
    const proseOnlyNames = ['left-pad', 'numpy', 'example-lib', 'django', 'flask'];
    for (const name of proseOnlyNames) {
      expect(deps.some((d) => d.name === name || d.name.endsWith(`:${name}`))).toBe(false);
    }
  });
});
