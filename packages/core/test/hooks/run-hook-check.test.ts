// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runHookCheck } from '../../src/hooks/run-hook-check.js';
import { server } from '../msw/server.js';

const DEPS_DEV = 'https://api.deps.dev/v3';
const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point/last-week';
const NPM_REGISTRY = /^https:\/\/registry\.npmjs\.org(:\d+)?\/(.+)$/;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function mockNonexistent(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'not found' }, { status: 404 }),
    ),
  );
}

function mockClean(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
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
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}/versions/1.0.0`, () =>
      HttpResponse.json({
        relatedProjects: [
          { projectKey: { id: `github.com/x/${name}` }, relationType: 'SOURCE_REPO' },
        ],
      }),
    ),
    http.get(NPM_REGISTRY, () =>
      HttpResponse.json({ time: { created: '2010-01-01T00:00:00.000Z' } }),
    ),
    http.get(`${NPM_DOWNLOADS}/${name}`, () => HttpResponse.json({ downloads: 999_999 })),
  );
}

function mockUnreachable(name: string): void {
  server.use(
    http.get(`${DEPS_DEV}/systems/NPM/packages/${name}`, () =>
      HttpResponse.json({ error: 'internal' }, { status: 503 }),
    ),
    http.get(NPM_REGISTRY, () => HttpResponse.json({ error: 'internal' }, { status: 503 })),
  );
}

describe('runHookCheck', () => {
  it('allows a non-install command with zero registry calls (FR-9.4 parity)', async () => {
    // onUnhandledRequest: 'error' means any network call here would fail the test.
    const result = await runHookCheck({ toolName: 'Bash', command: 'npm run build' });

    expect(result).toEqual({
      decision: 'allow',
      reason: 'not a recognized install command',
      verdicts: [],
      unreachable: [],
    });
  });

  it('denies a nonexistent package', async () => {
    mockNonexistent('this-package-does-not-exist-hook-test');

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install this-package-does-not-exist-hook-test',
    });

    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('Does not exist on the npm registry.');
    expect(result.verdicts[0].tier).toBe('BLOCK');
  });

  it('tells the agent, one package per line, what was blocked and what to do instead', async () => {
    mockNonexistent('zz-agent-text-ghost');

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install zz-agent-text-ghost',
    });

    expect(result.reason.split('\n')).toEqual([
      'SlopSquatShield blocked this command: 1 package looks hallucinated or risky.',
      '- zz-agent-text-ghost (npm): Does not exist on the npm registry.',
      'Do not install it. If it is a typo of a real package, use the correct name; otherwise tell the user what was blocked and ask how to proceed. Do not try to get around this check.',
    ]);
    // The person gets one short line (Cursor's user_message).
    expect(result.summary).toBe(
      'SlopSquatShield blocked this install: zz-agent-text-ghost (does not exist).',
    );
  });

  it('never tells the agent how to get around the check', async () => {
    mockNonexistent('zz-agent-plain-ghost');

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install zz-agent-plain-ghost',
    });

    expect(result.reason).not.toMatch(
      /slopsquatshield allow|\.slopsquatshield|--no-verify|bypass/i,
    );
    expect(result.summary).not.toMatch(/slopsquatshield allow/i);
  });

  it('asks (not denies) for a WARN-only package', async () => {
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/no-repo-hook-test`, () =>
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
      http.get(`${DEPS_DEV}/systems/NPM/packages/no-repo-hook-test/versions/1.0.0`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
      http.get(NPM_REGISTRY, () =>
        HttpResponse.json({ time: { created: '2010-01-01T00:00:00.000Z' } }),
      ),
      http.get(`${NPM_DOWNLOADS}/no-repo-hook-test`, () =>
        HttpResponse.json({ downloads: 999_999 }),
      ),
    );

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install no-repo-hook-test',
    });

    expect(result.decision).toBe('ask');
    expect(result.reason.split('\n')).toEqual([
      "SlopSquatShield: 1 package in this command looks risky, so it needs the user's confirmation.",
      '- no-repo-hook-test (npm): No source repository listed in the registry.',
      'Do not go ahead on your own judgement: let the user decide.',
    ]);
    expect(result.summary).toBe(
      'SlopSquatShield: confirm this install? no-repo-hook-test (looks risky).',
    );
  });

  it('allows a clean package', async () => {
    mockClean('totally-fine-hook-test');

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install totally-fine-hook-test',
    });

    expect(result.decision).toBe('allow');
    expect(result.verdicts[0].tier).toBe('CLEAN');
  });

  it('allows (not denies/asks) when only a registry was unreachable (NFR-3.1 fail-open)', async () => {
    mockUnreachable('flaky-hook-test');

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install flaky-hook-test',
    });

    expect(result.decision).toBe('allow');
    expect(result.unreachable).toHaveLength(1);
    // Fail-open must not read as "verified": say the check didn't happen.
    expect(result.reason).toContain('could not verify');
    expect(result.reason).toContain('flaky-hook-test');
    expect(result.reason).not.toContain('found nothing wrong');
  });

  it('a BLOCK anywhere wins over a WARN elsewhere in the same command', async () => {
    mockNonexistent('hallucinated-hook-multi');
    server.use(
      http.get(`${DEPS_DEV}/systems/NPM/packages/fresh-hook-multi`, () =>
        HttpResponse.json({
          versions: [
            {
              versionKey: { version: '1.0.0' },
              publishedAt: new Date().toISOString(),
              isDefault: true,
            },
          ],
        }),
      ),
      http.get(`${DEPS_DEV}/systems/NPM/packages/fresh-hook-multi/versions/1.0.0`, () =>
        HttpResponse.json({ relatedProjects: [] }),
      ),
      http.get(NPM_REGISTRY, () =>
        HttpResponse.json({ time: { created: new Date().toISOString() } }),
      ),
      http.get(`${NPM_DOWNLOADS}/fresh-hook-multi`, () => HttpResponse.json({ downloads: 1 })),
    );

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install hallucinated-hook-multi fresh-hook-multi',
    });

    expect(result.decision).toBe('deny');
  });
});
