// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runHookCheckFromStdin } from '../../src/hooks/hook-runner.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;

let cwd: string;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ssg-hook-runner-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('runHookCheckFromStdin', () => {
  it('parses the shared stdin shape and reaches a decision', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/this-package-does-not-exist-stdin-test`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );

    const stdinText = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm install this-package-does-not-exist-stdin-test' },
    });

    const result = await runHookCheckFromStdin({ cachePath: ':memory:', stdinText, cwd });

    expect(result.decision).toBe('deny');
  });

  it.each([
    ['npm --prefix . install zz-ghost-hoisted-prefix', 'NPM', 'zz-ghost-hoisted-prefix'],
    ['python -m pip install zz-ghost-python-dash-m', 'PYPI', 'zz-ghost-python-dash-m'],
    ['.venv/bin/pip install zz-ghost-venv-pip', 'PYPI', 'zz-ghost-venv-pip'],
    ['/usr/local/bin/npm install zz-ghost-npm-by-path', 'NPM', 'zz-ghost-npm-by-path'],
  ])('denies the same install spelled differently: %s', async (command, system, name) => {
    server.use(
      http.get(`${DEPS_DEV}/systems/${system}/packages/${name}`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
    const stdinText = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

    const result = await runHookCheckFromStdin({ cachePath: ':memory:', stdinText, cwd });

    expect(result.decision).toBe('deny');
  });

  it('passes through (allow) for a non-install command, zero registry calls', async () => {
    const stdinText = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } });

    const result = await runHookCheckFromStdin({ cachePath: ':memory:', stdinText, cwd });

    expect(result.decision).toBe('allow');
  });

  describe('an agent that edits package.json and then runs a bare install (#25)', () => {
    const ghostManifest = (dir: string) =>
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'app', dependencies: { 'zz-ghost-in-manifest': '1.0.0' } }),
      );
    const stdin = (command: string, hostCwd: string) =>
      JSON.stringify({ cwd: hostCwd, tool_name: 'Bash', tool_input: { command } });
    const mockGhost = () =>
      server.use(
        http.get(`${DEPS_DEV}/systems/NPM/packages/zz-ghost-in-manifest`, () =>
          HttpResponse.json({ error: 'not found' }, { status: 404 }),
        ),
      );

    it('denies a bare "npm install" when the manifest lists a ghost, saying where it is declared', async () => {
      ghostManifest(cwd);
      mockGhost();

      const result = await runHookCheckFromStdin({
        cachePath: ':memory:',
        stdinText: stdin('npm install', cwd),
        cwd,
      });

      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('zz-ghost-in-manifest');
      expect(result.reason).toContain('declared in');
      expect(result.manifestsChecked?.[0]).toContain('package.json');
    });

    it('follows a cd in the command to the manifest it will really use', async () => {
      mkdirSync(join(cwd, 'app'));
      ghostManifest(join(cwd, 'app'));
      mockGhost();

      const result = await runHookCheckFromStdin({
        cachePath: ':memory:',
        stdinText: stdin('cd app && npm ci', cwd),
        cwd,
      });

      expect(result.decision).toBe('deny');
    });

    it('allows (and says it found nothing wrong, naming the manifest) when everything it lists is fine', async () => {
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'app', dependencies: {} }));

      const result = await runHookCheckFromStdin({
        cachePath: ':memory:',
        stdinText: stdin('npm install', cwd),
        cwd,
      });

      expect(result.decision).toBe('allow');
      expect(result.reason).toContain('found nothing wrong');
      expect(result.reason).toContain('package.json');
    });

    it('allows a bare install in a directory with no manifest, with zero registry calls', async () => {
      const result = await runHookCheckFromStdin({
        cachePath: ':memory:',
        stdinText: stdin('npm install', cwd),
        cwd,
      });

      expect(result.decision).toBe('allow');
    });
  });

  it('fails open on unparseable stdin, saying so', async () => {
    const result = await runHookCheckFromStdin({
      cachePath: ':memory:',
      stdinText: 'not json',
      cwd,
    });

    expect(result.decision).toBe('allow');
    expect(result.reason).toContain('could not parse the hook input');
  });

  it('reports Cursor as the caller so the Claude Code adapter can answer it properly', async () => {
    const stdinText = JSON.stringify({
      tool_name: 'Shell',
      tool_input: { command: 'ls' },
      workspace_roots: [cwd],
    });

    const result = await runHookCheckFromStdin({ cachePath: ':memory:', stdinText, cwd });

    expect(result.caller).toBe('cursor');
  });

  it('suppresses a finding for an allowlisted package (allow instead of deny)', async () => {
    writeFileSync(join(cwd, '.slopsquatshield'), 'allowlisted-hook-pkg\n');
    // No mock registered — onUnhandledRequest: 'error' means allowlisting must short-circuit
    // before any network call, same as resolveVerdict's own allowlist fast path.

    const stdinText = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'npm install allowlisted-hook-pkg' },
    });

    const result = await runHookCheckFromStdin({ cachePath: ':memory:', stdinText, cwd });

    expect(result.decision).toBe('allow');
    // Not "found nothing wrong": the allowlist is why nothing was flagged, and the reason says so (#28).
    expect(result.reason).toContain('allowlisted in .slopsquatshield');
    expect(result.reason).not.toContain('found nothing wrong');
  });

  describe('host-reported cwd', () => {
    it("uses the stdin payload's cwd to find the project allowlist", async () => {
      writeFileSync(join(cwd, '.slopsquatshield'), 'allowlisted-via-stdin-cwd\n');
      const stdinText = JSON.stringify({
        cwd,
        tool_name: 'Bash',
        tool_input: { command: 'npm install allowlisted-via-stdin-cwd' },
      });

      // No `cwd` option and no registry mock: only the stdin cwd can short-circuit this.
      const result = await runHookCheckFromStdin({ cachePath: ':memory:', stdinText });

      expect(result.decision).toBe('allow');
    });

    it('ignores a stdin cwd this process cannot see (WSL path under Windows node.exe)', async () => {
      server.use(
        http.get(`${DEPS_DEV}/systems/NPM/packages/unseen-cwd-pkg`, () =>
          HttpResponse.json({ error: 'not found' }, { status: 404 }),
        ),
      );
      const stdinText = JSON.stringify({
        cwd: join(cwd, 'does', 'not', 'exist'),
        tool_name: 'Bash',
        tool_input: { command: 'npm install unseen-cwd-pkg' },
      });

      const result = await runHookCheckFromStdin({ cachePath: ':memory:', stdinText, cwd });

      expect(result.decision).toBe('deny');
    });
  });
});
