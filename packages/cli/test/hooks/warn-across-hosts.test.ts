// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formatAntigravityHookOutput } from '../../src/hooks/antigravity.js';
import { formatClaudeCodeHookOutput } from '../../src/hooks/claude-code.js';
import { formatCodexHookOutput } from '../../src/hooks/codex.js';
import { formatCursorHookOutput } from '../../src/hooks/cursor.js';
import type { HookHost } from '../../src/hooks/hook-command.js';
import { runHookCheckFromStdin } from '../../src/hooks/hook-runner.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;
const PKG = 'warn-fixture-no-repo';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ssg-warn-hosts-'));
  // The WARN fixture: an old, popular package with no repository link (a single WARN signal).
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${PKG}`, () =>
      HttpResponse.json({
        versions: [
          {
            versionKey: { version: '1.0.0' },
            publishedAt: '2010-01-01T00:00:00Z',
            isDefault: true,
          },
        ],
      }),
    ),
    http.get(`${DEPS_DEV}/systems/NPM/packages/${PKG}/versions/1.0.0`, () =>
      HttpResponse.json({ relatedProjects: [] }),
    ),
    http.get(NPM_REGISTRY, () =>
      HttpResponse.json({ time: { created: '2010-01-01T00:00:00.000Z' } }),
    ),
    http.get(`${NPM_DOWNLOADS}/${PKG}`, () => HttpResponse.json({ downloads: 999_999 })),
  );
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const claudeShape = JSON.stringify({
  tool_name: 'Bash',
  tool_input: { command: `npm install ${PKG}` },
});
const antigravityShape = JSON.stringify({
  toolCall: { name: 'run_command', args: { CommandLine: `npm install ${PKG}` } },
});

async function decide(host: HookHost, stdinText: string) {
  return runHookCheckFromStdin({ host, stdinText, cwd, cachePath: ':memory:' });
}

describe('one WARN fixture, every host (FR-12.5)', () => {
  it('Claude Code and Cursor → ask', async () => {
    const claude = await decide('claude-code', claudeShape);
    const cursor = await decide('cursor', claudeShape);
    expect(
      JSON.parse(formatClaudeCodeHookOutput(claude)).hookSpecificOutput.permissionDecision,
    ).toBe('ask');
    expect(JSON.parse(formatCursorHookOutput(cursor)).permission).toBe('ask');
  });

  it('Antigravity → ask (supported there)', async () => {
    const result = await decide('antigravity', antigravityShape);
    expect(JSON.parse(formatAntigravityHookOutput(result)).decision).toBe('ask');
  });

  it('Codex → allowed through: no output at all, never "ask", never blocked', async () => {
    const result = await decide('codex', claudeShape);
    expect(result.decision).toBe('ask'); // the shared engine still saw the WARN…
    const out = formatCodexHookOutput(result);
    expect(out.stdout).toBe(''); // …but Codex gets an allow-through, not a deny and not an "ask"
    expect(out.stderr).toContain('No source repository listed');
  });
});
