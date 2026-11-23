// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
// Runs INSIDE the VS Code extension host (loaded by @vscode/test-electron). Plain assert, no
// test framework: a thrown error fails the run. The registry is replaced through the
// extension's injectable fetch, so a hallucinated package needs no network (deps.dev answers
// 404 → BLOCK without any native-registry call).
const assert = require('node:assert');
const vscode = require('vscode');

const EXTENSION_ID = 'agivant.slopsquatshield-vscode';

const fakeFetch = async (url) => {
  // Every lookup says "not found": zz-ghost-pkg is a hallucination. The test never asks about
  // anything else being healthy, so no other response shape is needed.
  if (String(url).includes('api.deps.dev')) return new Response('{}', { status: 404 });
  return new Response('{}', { status: 503 });
};

const diagnosticsFor = (uri) =>
  vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'SlopSquatShield');
const findGhost = (diagnostics) => diagnostics.find((d) => d.message.includes('zz-ghost-pkg'));

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} was not found by the host`);
  const api = await extension.activate();
  assert.ok(extension.isActive, 'extension did not activate');
  api.setFetchImplForTests(fakeFetch);

  const uri = vscode.Uri.file(`${process.env.SSG_ITEST_WORKSPACE}/package.json`);
  const doc = await vscode.workspace.openTextDocument(uri);
  const scanned = await api.scanNow(uri);

  // FR-19.1/19.4: a BLOCK is an Error diagnostic on the dependency, carrying the engine's reason.
  // Wait for it rather than reading once: activation's workspace scan can start a newer scan of
  // this file while scanNow is in flight, and only the newest scan of a file publishes.
  let diagnostics = diagnosticsFor(uri);
  for (let waited = 0; waited < 10_000 && !findGhost(diagnostics); waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    diagnostics = diagnosticsFor(uri);
  }
  const ghost = findGhost(diagnostics);
  assert.ok(
    ghost,
    `no diagnostic for zz-ghost-pkg; got: ${JSON.stringify(diagnostics.map((d) => d.message))}; ` +
      `scanNow returned: ${JSON.stringify(scanned.map((f) => f.message))}`,
  );
  assert.strictEqual(ghost.severity, vscode.DiagnosticSeverity.Error);
  // The message names the package (the Problems list shows only message, file and line).
  assert.ok(ghost.message.startsWith('zz-ghost-pkg: '), ghost.message);
  assert.ok(/does not exist/i.test(ghost.message), ghost.message);
  assert.strictEqual(
    doc.getText(ghost.range),
    '"zz-ghost-pkg"',
    'squiggle is not over the dependency key',
  );

  // FR-19.2: the quick fixes appear in the real lightbulb provider. Ask until they do: the
  // diagnostic above is read in the extension host, but code actions are computed in the main
  // process, which receives diagnostics asynchronously. Until it has them, it calls the provider
  // with no diagnostics and gets nothing back (seen in CI, 2026-11-13: only the editor's own
  // actions came back).
  const removeTitle = 'Remove "zz-ghost-pkg" from this manifest';
  let actions = [];
  for (let waited = 0; waited < 10_000; waited += 100) {
    actions = await vscode.commands.executeCommand(
      'vscode.executeCodeActionProvider',
      uri,
      ghost.range,
    );
    if (actions.some((a) => a.title === removeTitle)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const titles = actions.map((a) => a.title);
  assert.ok(titles.includes(removeTitle), `no remove fix in ${titles}`);
  assert.ok(
    titles.some((t) => t.startsWith('Add "zz-ghost-pkg" to .slopsquatshield')),
    `no allowlist fix in ${titles}`,
  );
  assert.ok(
    !titles.some((t) => t.startsWith('Did you mean')),
    'did-you-mean offered without a similarity signal',
  );

  // Apply the remove fix for real and check the manifest is still valid JSON without the package.
  const remove = actions.find((a) => a.title.startsWith('Remove "zz-ghost-pkg"'));
  assert.ok(await vscode.workspace.applyEdit(remove.edit), 'the remove edit was rejected');
  const after = JSON.parse(doc.getText());
  assert.ok(!('zz-ghost-pkg' in after.dependencies), 'zz-ghost-pkg is still declared');
  assert.ok('zz-kept-pkg' in after.dependencies, 'removed the wrong dependency');

  console.log('SlopSquatShield integration checks passed in a real VS Code', vscode.version);
}

module.exports = { run };
