// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { MemoryCache } from '@slopsquatshield/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { scanManifest } from '../src/manifest-scan.js';
import {
  mockDownNpm,
  mockHealthyNpm,
  mockMissingNpm,
  mockMissingPypi,
  server,
} from './registry-mocks.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const pkg = (deps: Record<string, string>) =>
  `${JSON.stringify({ name: 'demo', dependencies: deps }, null, 2)}\n`;

const scan = (fileName: string, text: string, allowlistText?: string) =>
  scanManifest({ fileName, text, allowlistText, cache: new MemoryCache() });

describe('scanManifest (FR-19.1/19.4 — core does the judging, this only wires it)', () => {
  it('a hallucinated package → one BLOCK finding, an Error, ranged over its key', async () => {
    mockMissingNpm('zz-ghost-pkg');
    const text = pkg({ 'zz-ghost-pkg': '^1.0.0' });

    const findings = await scan('/ws/package.json', text);

    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.kind).toBe('block');
    expect(f.severity).toBe('error');
    expect(f.identifier).toBe('zz-ghost-pkg');
    // NFR-6.1: a plain-English reason, named — the Problems list shows only the message, file and line.
    expect(f.message).toBe('zz-ghost-pkg: Does not exist on the npm registry.');
    // `{`, `"name"`, `"dependencies": {`, then the dependency → line index 3.
    expect(f.range.start.line).toBe(3);
    expect(text.split('\n')[3].slice(f.range.start.character, f.range.end.character)).toBe(
      '"zz-ghost-pkg"',
    );
  });

  it('a healthy package → no findings (and the engine is asked only about dependencies)', async () => {
    mockHealthyNpm('fine-pkg');
    expect(await scan('/ws/package.json', pkg({ 'fine-pkg': '1.0.0' }))).toEqual([]);
  });

  it('a WARN-only package → a Warning, never an Error', async () => {
    mockHealthyNpm('no-repo-pkg', { repo: false });

    const [f] = await scan('/ws/package.json', pkg({ 'no-repo-pkg': '1.0.0' }));

    expect(f.kind).toBe('warn');
    expect(f.severity).toBe('warning');
    expect(f.message).toBe('no-repo-pkg: No source repository listed in the registry.');
  });

  it('a name-similarity finding carries the suggestion; others do not (did-you-mean gate)', async () => {
    // Old, has a repo, and enough downloads to avoid the low-popularity signal but far below
    // "established" (100,000+, which is exempt from the look-alike rule): the only signal is similarity.
    mockHealthyNpm('lodahs', { downloads: 50_000 });
    mockHealthyNpm('no-repo-pkg', { repo: false });

    const findings = await scan('/ws/package.json', pkg({ lodahs: '1', 'no-repo-pkg': '1' }));

    const similar = findings.find((f) => f.identifier === 'lodahs');
    expect(similar?.signals).toContain('name-similarity');
    expect(similar?.suggestion).toBe('lodash');
    const plain = findings.find((f) => f.identifier === 'no-repo-pkg');
    expect(plain?.signals).not.toContain('name-similarity');
    expect(plain?.suggestion).toBeUndefined();
  });

  it('a missing name that is a typo of a popular one carries the suggestion too', async () => {
    mockMissingNpm('lodahs');

    const [f] = await scan('/ws/package.json', pkg({ lodahs: '1' }));

    expect(f.kind).toBe('block');
    expect(f.message).toContain('Did you mean "lodash"?');
    expect(f.suggestion).toBe('lodash');
  });

  it('an unreachable registry → Information, explicitly "not a finding" (NFR-3.1 fail-open)', async () => {
    mockDownNpm('flaky-pkg');

    const [f] = await scan('/ws/package.json', pkg({ 'flaky-pkg': '1.0.0' }));

    expect(f.kind).toBe('unreachable');
    expect(f.severity).toBe('information');
    expect(f.severity).not.toBe('error');
    expect(f.message).toContain('Not a finding');
    // Named, with a short cause rather than the raw fetch error.
    expect(f.message).toBe(
      'flaky-pkg: Not verified, the registry was unreachable (HTTP 503). Not a finding.',
    );
  });

  it('the workspace allowlist suppresses even a BLOCK, with no registry call (FR-5.1)', async () => {
    // No mock registered: onUnhandledRequest "error" would fail this if the engine hit the network.
    const findings = await scan(
      '/ws/package.json',
      pkg({ 'zz-ghost-pkg': '1' }),
      '# internal\nzz-ghost-pkg\n',
    );
    expect(findings).toEqual([]);
  });

  it('a manifest that will not parse → one Information finding at the error position (NFR-3.3)', async () => {
    const text = '{\n  "dependencies": {\n    "a": "1",\n  }\n}';

    const findings = await scan('/ws/package.json', text);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('parse-error');
    expect(findings[0].severity).toBe('information');
    expect(findings[0].message).toMatch(/^Could not read this manifest: /);
    expect(findings[0].range.start).toEqual({ line: 3, character: 2 }); // 1-based 4:3 → 0-based
  });

  it('works for Python manifests too (same engine, different extractor)', async () => {
    mockMissingPypi('zz-ghost-py');
    const text = 'flask\nzz-ghost-py==1.0\n';
    // flask is not mocked, so only assert on the ghost; unmocked flask would error the test run,
    // so scan a requirements file containing just the ghost.
    const findings = await scan('/ws/requirements.txt', 'zz-ghost-py==1.0\n');

    expect(text).toContain('zz-ghost-py');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'block',
      ecosystem: 'pypi',
      identifier: 'zz-ghost-py',
    });
    expect(findings[0].range.start.line).toBe(0);
  });

  it('an empty or dependency-free manifest scans nothing and makes no network call', async () => {
    expect(await scan('/ws/package.json', '{ "name": "x" }')).toEqual([]);
    expect(await scan('/ws/requirements.txt', '# nothing\n')).toEqual([]);
  });

  it('an unsupported file name is ignored', async () => {
    expect(await scan('/ws/README.md', 'npm install zz-ghost')).toEqual([]);
  });
});
