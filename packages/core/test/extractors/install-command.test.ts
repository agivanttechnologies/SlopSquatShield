// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractInstallCommandDeps } from '../../src/extractors/install-command.js';

const fixturePath = fileURLToPath(
  new URL('../fixtures/install-commands/commands.txt', import.meta.url),
);
const fixture = readFileSync(fixturePath, 'utf-8');

describe('extractInstallCommandDeps', () => {
  it('extracts every dependency across npm/pip/uv/poetry/mvn commands and pasted <dependency> blocks', () => {
    const deps = extractInstallCommandDeps(fixture);
    // 9 npm + 8 pypi (pip -r/-e lines contribute 0) + 4 maven (2 mvn + 2 xml blocks) = 21.
    expect(deps).toHaveLength(21);
  });

  it('parses npm scoped packages and multi-package lines', () => {
    const deps = extractInstallCommandDeps(fixture);
    const babelCore = deps.find((d) => d.name === '@babel/core');
    const babelPreset = deps.find((d) => d.name === '@babel/preset-env');
    expect(babelCore).toMatchObject({ ecosystem: 'npm', specifier: undefined });
    expect(babelPreset).toMatchObject({ ecosystem: 'npm', specifier: undefined });
  });

  it('parses npm name@version and strips flags', () => {
    const deps = extractInstallCommandDeps(fixture);
    expect(deps.find((d) => d.name === 'lodash')).toMatchObject({
      ecosystem: 'npm',
      specifier: '4.17.21',
    });
    expect(deps.find((d) => d.name === 'typescript')).toMatchObject({
      ecosystem: 'npm',
      specifier: undefined,
    });
    expect(deps.find((d) => d.name === 'nodemon')).toMatchObject({
      ecosystem: 'npm',
      specifier: undefined,
    });
  });

  it('parses pip extras+range specifiers and skips -r/-e directive lines', () => {
    const deps = extractInstallCommandDeps(fixture);
    const requestsWithExtras = deps.find(
      (d) => d.name === 'requests' && d.extras?.includes('socks'),
    );
    expect(requestsWithExtras).toMatchObject({ ecosystem: 'pypi', specifier: '>=2.31,<3' });

    // -r requirements.txt and -e . must not surface as fake package names.
    expect(deps.some((d) => d.name === 'requirements.txt')).toBe(false);
    expect(deps.some((d) => d.name === '.')).toBe(false);
  });

  it('parses uv add/uv pip install in pip-style syntax', () => {
    const deps = extractInstallCommandDeps(fixture);
    expect(deps.find((d) => d.name === 'httpx')).toMatchObject({
      ecosystem: 'pypi',
      specifier: undefined,
    });
    expect(deps.find((d) => d.name === 'rich')).toMatchObject({
      ecosystem: 'pypi',
      specifier: '==13.7.0',
    });
  });

  it('parses poetry name[extras]@specifier syntax', () => {
    const deps = extractInstallCommandDeps(fixture);
    const uvicorn = deps.find((d) => d.name === 'uvicorn');
    expect(uvicorn).toMatchObject({
      ecosystem: 'pypi',
      specifier: '^0.30.0',
      extras: ['standard'],
    });
    expect(deps.find((d) => d.name === 'fastapi')).toMatchObject({
      ecosystem: 'pypi',
      specifier: undefined,
    });
  });

  it('parses mvn dependency:get coordinates with and without packaging', () => {
    const deps = extractInstallCommandDeps(fixture);
    expect(
      deps.find((d) => d.name === 'com.fasterxml.jackson.core:jackson-databind'),
    ).toMatchObject({
      ecosystem: 'maven',
      specifier: '2.17.0',
    });
    expect(deps.find((d) => d.name === 'org.apache.commons:commons-lang3')).toMatchObject({
      ecosystem: 'maven',
      specifier: '3.14.0',
    });
  });

  it('parses pasted <dependency> XML blocks', () => {
    const deps = extractInstallCommandDeps(fixture);
    expect(deps.find((d) => d.name === 'org.springframework:spring-core')).toMatchObject({
      ecosystem: 'maven',
      specifier: '6.1.5',
    });
    expect(deps.find((d) => d.name === 'junit:junit')).toMatchObject({
      ecosystem: 'maven',
      specifier: '4.13.2',
    });
  });
});
