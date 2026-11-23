// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { CREDIT } from '@slopsquatshield/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type SlopSquatShieldApi, activate } from '../src/extension.js';
import { summarize } from '../src/status.js';
import {
  type CodeAction,
  type Diagnostic,
  DiagnosticSeverity,
  Uri,
  fire,
  reset,
  state,
} from './fake-vscode.js';
import { mockDownNpm, mockHealthyNpm, mockMissingNpm, server } from './registry-mocks.js';

// `vscode` is aliased to ./fake-vscode.ts by the root vitest config.
void vscode;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ROOT = '/ws';
const MANIFEST = `${ROOT}/package.json`;
const manifestUri = Uri.file(MANIFEST);

const pkg = (deps: Record<string, string>) =>
  `${JSON.stringify({ name: 'demo', dependencies: deps }, null, 2)}\n`;

let api: SlopSquatShieldApi;
// The fake `Uri` is a structural stand-in for vscode's; the API is typed against the real one.
const scanNow = (uri: Uri) => api.scanNow(uri as never);

/** Puts a manifest on the fake disk and opens it in the fake editor. */
function openManifest(text: string, path = MANIFEST): Uri {
  state.files.set(path, text);
  const uri = Uri.file(path);
  state.openDocuments.push({ uri, getText: () => state.files.get(path) ?? '' });
  return uri;
}

const diagnosticsOf = (uri: Uri): Diagnostic[] => state.collections[0].get(uri);
const statusText = () => state.statusItems[0].text;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  reset();
  state.config.set('slopsquatshield.debounceMs', 20);
});

async function boot(): Promise<void> {
  api = activate({ subscriptions: [] } as never);
  await sleep(0); // let the activation-time workspace scan settle
}

describe('activation', () => {
  it('registers a diagnostics collection, a status bar item, the quick-fix provider and both commands', async () => {
    await boot();
    expect(state.collections).toHaveLength(1);
    expect(state.statusItems).toHaveLength(1);
    expect(state.statusItems[0].command).toBe('workbench.actions.view.problems');
    expect(state.codeActionProviders).toHaveLength(1);
    expect([...state.commands.keys()].sort()).toEqual([
      'slopsquatshield.addToAllowlist',
      'slopsquatshield.scanWorkspace',
    ]);
    expect(statusText()).toContain('clean');
  });

  it('scans the workspace manifests on activation (FR-19.3)', async () => {
    mockMissingNpm('zz-ghost');
    const uri = openManifest(pkg({ 'zz-ghost': '1' }));
    await boot();
    await sleep(150); // activation's scanWorkspace runs async against msw

    expect(diagnosticsOf(uri)).toHaveLength(1);
    expect(statusText()).toContain('1 blocked');
  });
});

describe('diagnostics (FR-19.1/19.4)', () => {
  it('BLOCK → Error, with source SlopSquatShield and the engine’s own reason', async () => {
    mockMissingNpm('zz-ghost');
    await boot();
    const uri = openManifest(pkg({ 'zz-ghost': '1' }));

    await scanNow(uri);

    const [d] = diagnosticsOf(uri);
    expect(d.severity).toBe(DiagnosticSeverity.Error);
    expect(d.source).toBe('SlopSquatShield');
    expect(d.message).toBe('zz-ghost: Does not exist on the npm registry.');
    expect(d.range.start.line).toBe(3);
    expect(statusText()).toContain('1 blocked');
  });

  it('WARN → Warning; unreachable → Information (never Error)', async () => {
    mockHealthyNpm('no-repo-pkg', { repo: false });
    mockDownNpm('flaky-pkg');
    await boot();
    const uri = openManifest(pkg({ 'no-repo-pkg': '1', 'flaky-pkg': '1' }));

    await scanNow(uri);

    const bySeverity = new Map(
      diagnosticsOf(uri).map((d) => [d.message.includes('Not a finding'), d]),
    );
    expect(bySeverity.get(false)?.severity).toBe(DiagnosticSeverity.Warning);
    expect(bySeverity.get(true)?.severity).toBe(DiagnosticSeverity.Information);
    expect(diagnosticsOf(uri).some((d) => d.severity === DiagnosticSeverity.Error)).toBe(false);
  });

  it('the status bar reports the workspace’s worst tier in the four-code scheme', async () => {
    mockDownNpm('flaky-pkg');
    await boot();
    await scanNow(openManifest(pkg({ 'flaky-pkg': '1' })));
    expect(statusText()).toContain('not verified');
    expect(state.statusItems[0].tooltip).not.toContain('Exit code');
  });

  it('a workspace allowlist suppresses a finding (FR-5.1/5.2)', async () => {
    state.files.set(`${ROOT}/.slopsquatshield`, 'zz-ghost\n');
    await boot();
    const uri = openManifest(pkg({ 'zz-ghost': '1' })); // no registry mock: any network call fails the test

    await scanNow(uri);

    expect(diagnosticsOf(uri)).toEqual([]);
    expect(statusText()).toContain('clean');
  });

  it('a malformed manifest shows one Information diagnostic, not a crash (NFR-3.3)', async () => {
    await boot();
    const uri = openManifest('{\n  "dependencies": {\n    "a": "1",\n  }\n}');

    await scanNow(uri);

    const [d] = diagnosticsOf(uri);
    expect(d.severity).toBe(DiagnosticSeverity.Information);
    expect(d.message).toContain('Could not read this manifest');
  });

  it('uses unsaved editor text, not what is on disk', async () => {
    mockMissingNpm('zz-typed-not-saved');
    await boot();
    const uri = openManifest(pkg({}));
    // The user types a bad dependency without saving.
    state.openDocuments[0].getText = () => pkg({ 'zz-typed-not-saved': '1' });

    await scanNow(uri);

    expect(diagnosticsOf(uri)).toHaveLength(1);
  });
});

describe('scheduling', () => {
  it('debounces: rapid open + saves of one file coalesce into a single scan', async () => {
    mockHealthyNpm('fine-pkg');
    await boot();
    const uri = openManifest(pkg({ 'fine-pkg': '1' }));
    const before = api.scansStarted();

    fire.open(uri);
    fire.save(uri);
    fire.save(uri);
    await sleep(5);
    expect(api.scansStarted()).toBe(before); // still inside the debounce window
    await sleep(120);

    expect(api.scansStarted()).toBe(before + 1);
  });

  it('ignores files that are not supported manifests, and non-file schemes', async () => {
    await boot();
    const before = api.scansStarted();

    fire.open(Uri.file('/ws/README.md'));
    fire.open(Uri.parse('untitled:///ws/package.json'));
    await sleep(80);

    expect(api.scansStarted()).toBe(before);
  });

  it('does nothing when the extension is disabled by setting', async () => {
    state.config.set('slopsquatshield.enable', false);
    await boot();
    const uri = openManifest(pkg({ 'zz-ghost': '1' }));
    const before = api.scansStarted();

    fire.save(uri);
    await sleep(80);

    expect(api.scansStarted()).toBe(before);
    expect(diagnosticsOf(uri)).toEqual([]);
  });

  it('clears diagnostics for a deleted manifest', async () => {
    mockMissingNpm('zz-ghost');
    await boot();
    const uri = openManifest(pkg({ 'zz-ghost': '1' }));
    await scanNow(uri);
    expect(diagnosticsOf(uri)).toHaveLength(1);

    fire.deleted(uri);

    expect(diagnosticsOf(uri)).toEqual([]);
    expect(statusText()).toContain('clean');
  });
});

describe('quick fixes (FR-19.2)', () => {
  const actionsFor = (uri: Uri): CodeAction[] => {
    const diagnostics = diagnosticsOf(uri);
    const doc = { uri, getText: () => state.files.get(uri.fsPath) ?? '' };
    return state.codeActionProviders[0].provideCodeActions(doc, undefined, { diagnostics });
  };

  it('offers remove + allowlist for a BLOCK; the remove edit leaves valid JSON', async () => {
    mockMissingNpm('zz-ghost');
    mockHealthyNpm('zz-keeper-lib');
    await boot();
    const uri = openManifest(pkg({ 'zz-ghost': '1', 'zz-keeper-lib': '2' }));
    await scanNow(uri);

    const actions = actionsFor(uri);

    expect(actions.map((a) => a.title)).toEqual([
      'Remove "zz-ghost" from this manifest',
      'Add "zz-ghost" to .slopsquatshield (suppress this finding)',
    ]);
    const edit = actions[0].edit?.edits[0];
    expect(edit?.newText).toBe('');
    expect(edit?.range.start.line).toBe(3); // the whole dependency line goes
  });

  it('did-you-mean appears only for the similarity finding', async () => {
    mockHealthyNpm('lodahs', { downloads: 50_000 }); // modest, so the look-alike signal applies
    mockHealthyNpm('no-repo-pkg', { repo: false });
    await boot();
    const uri = openManifest(pkg({ lodahs: '1', 'no-repo-pkg': '1' }));
    await scanNow(uri);

    const all = actionsFor(uri);

    expect(all.filter((a) => a.title.startsWith('Did you mean'))).toHaveLength(1);
    const dym = all.find((a) => a.title.startsWith('Did you mean'));
    expect(dym?.title).toBe('Did you mean "lodash"?');
    expect(dym?.edit?.edits[0].newText).toBe('"lodash"'); // quotes kept: still valid JSON
  });

  it('offers did-you-mean on a missing name that is a typo of a popular one, but not on a plain ghost', async () => {
    mockMissingNpm('lodahs');
    mockMissingNpm('zz-ghost');
    await boot();
    const uri = openManifest(pkg({ lodahs: '1', 'zz-ghost': '1' }));
    await scanNow(uri);

    const titles = actionsFor(uri).map((a) => a.title);

    expect(titles.filter((t) => t.startsWith('Did you mean'))).toEqual(['Did you mean "lodash"?']);
  });

  it('offers nothing for an unreachable-registry diagnostic', async () => {
    mockDownNpm('flaky-pkg');
    await boot();
    const uri = openManifest(pkg({ 'flaky-pkg': '1' }));
    await scanNow(uri);

    expect(actionsFor(uri)).toEqual([]);
  });

  it('"add to allowlist" appends via core and re-evaluates, clearing the finding', async () => {
    mockMissingNpm('zz-ghost');
    await boot();
    const uri = openManifest(pkg({ 'zz-ghost': '1' }));
    await scanNow(uri);
    const allow = actionsFor(uri).find(
      (a) => a.command?.command === 'slopsquatshield.addToAllowlist',
    );
    expect(allow).toBeDefined();

    const { command, arguments: args } = allow?.command as {
      command: string;
      arguments: unknown[];
    };
    await state.commands.get(command)?.(...args);
    expect(state.files.get(`${ROOT}/.slopsquatshield`)).toBe('zz-ghost\n');
    // The allowlist change reschedules a (debounced) rescan; poll rather than sleep a fixed
    // time — a slow Windows runner overran a 120 ms sleep.
    await vi.waitFor(() => expect(diagnosticsOf(uri)).toEqual([]), { timeout: 2000 });
  });

  it('adding the same identifier twice does not duplicate the line', async () => {
    mockMissingNpm('zz-ghost');
    await boot();
    const uri = openManifest(pkg({ 'zz-ghost': '1' }));
    await scanNow(uri);

    await state.commands.get('slopsquatshield.addToAllowlist')?.(uri, 'zz-ghost');
    await state.commands.get('slopsquatshield.addToAllowlist')?.(uri, 'zz-ghost');

    expect(state.files.get(`${ROOT}/.slopsquatshield`)).toBe('zz-ghost\n');
    expect(state.infos.at(-1)).toContain('already in');
  });

  it('a manifest in a subfolder uses that folder’s .slopsquatshield, as the CLI does (#35)', async () => {
    mockMissingNpm('zz-ghost');
    state.files.set(`${ROOT}/.slopsquatshield`, 'something-else\n'); // the workspace root's file
    await boot();
    const sub = `${ROOT}/apps/web/package.json`;
    const uri = openManifest(pkg({ 'zz-ghost': '1' }), sub);
    await scanNow(uri);
    expect(diagnosticsOf(uri)).not.toEqual([]); // the root allowlist doesn't apply to it

    await state.commands.get('slopsquatshield.addToAllowlist')?.(uri, 'zz-ghost');

    expect(state.files.get(`${ROOT}/apps/web/.slopsquatshield`)).toBe('zz-ghost\n');
    expect(state.files.get(`${ROOT}/.slopsquatshield`)).toBe('something-else\n');
    expect(state.infos.at(-1)).toContain(`${ROOT}/apps/web/.slopsquatshield`);
    await vi.waitFor(() => expect(diagnosticsOf(uri)).toEqual([]), { timeout: 2000 });
  });

  it('a subfolder project reads its own .slopsquatshieldrc, not the workspace root’s', async () => {
    mockHealthyNpm('@acme/ui');
    state.files.set(`${ROOT}/svc/.slopsquatshieldrc`, '{"privateScopes":{"npm":["@acme"]}}');
    await boot();
    const uri = openManifest(pkg({ '@acme/ui': '1' }), `${ROOT}/svc/package.json`);

    await scanNow(uri);

    expect(diagnosticsOf(uri)[0]?.severity).toBe(DiagnosticSeverity.Error);
  });
});

describe('advisory framing (§5A)', () => {
  it('the extension’s own manifest never claims to be the enforcement boundary', async () => {
    const pkgJson = (await import('../package.json', { with: { type: 'json' } })).default;
    expect(pkgJson.description).toMatch(/only reports/i);
    expect(pkgJson.description).not.toMatch(/unbypassable|blocks? installs?/i);
  });
});

describe('project config (FR-4.1 / FR-6.1)', () => {
  it('a declared private scope turns a public hit into a BLOCK', async () => {
    mockHealthyNpm('@acme/ui');
    state.files.set(`${ROOT}/.slopsquatshieldrc`, '{"privateScopes":{"npm":["@acme"]}}');
    await boot();
    const uri = openManifest(pkg({ '@acme/ui': '1' }));

    await scanNow(uri);

    const [d] = diagnosticsOf(uri);
    expect(d.severity).toBe(DiagnosticSeverity.Error);
  });

  it('the package.json "slopsquatshield" key works too', async () => {
    mockHealthyNpm('@acme/ui');
    await boot();
    const text = `${JSON.stringify({
      name: 'demo',
      dependencies: { '@acme/ui': '1' },
      slopsquatshield: { privateScopes: { npm: ['@acme'] } },
    })}\n`;
    const uri = openManifest(text);

    await scanNow(uri);

    expect(diagnosticsOf(uri)[0]?.severity).toBe(DiagnosticSeverity.Error);
  });

  it('without a config the same package is clean', async () => {
    mockHealthyNpm('@acme/ui');
    await boot();
    const uri = openManifest(pkg({ '@acme/ui': '1' }));
    await scanNow(uri);
    expect(diagnosticsOf(uri)).toEqual([]);
  });

  it('a broken config falls back to defaults and is logged once, not silently', async () => {
    mockHealthyNpm('fine-pkg');
    state.files.set(`${ROOT}/.slopsquatshieldrc`, '{ nope');
    await boot();
    const uri = openManifest(pkg({ 'fine-pkg': '1' }));

    await scanNow(uri);
    await scanNow(uri);

    expect(diagnosticsOf(uri)).toEqual([]);
    // The channel opens with the credit line; the config problem is logged once after it.
    const logged = state.output.filter((line) => line !== CREDIT);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('using defaults');
  });

  it('opens the output channel with the credit, and carries it in the status tooltip', async () => {
    await boot();

    expect(state.output[0]).toBe(CREDIT);
    expect(summarize([]).tooltip).toContain(CREDIT);
  });
});
