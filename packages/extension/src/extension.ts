// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import {
  CREDIT,
  type FactCache,
  MemoryCache,
  appendToAllowlist,
  createScanLimit,
  isSupportedManifest,
  parseAllowlist,
  setUserAgent,
} from '@slopsquatshield/core';
import * as vscode from 'vscode';
import { quickFixesFor } from './actions.js';
import type { Finding } from './findings.js';
import { scanManifest } from './manifest-scan.js';
import { summarize } from './status.js';

/** Injected at build time by esbuild from package.json (see esbuild.mjs); absent under Vitest. */
declare const __SSG_VERSION__: string | undefined;

const SOURCE = 'SlopSquatShield';
const MANIFEST_GLOB = '**/{package.json,requirements.txt,pyproject.toml,Pipfile,pom.xml}';
const EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,out,.venv,venv,target,__pycache__}/**';
const MAX_WORKSPACE_MANIFESTS = 500;
/** Manifests read and parsed at once; their registry requests all share `limit` below. */
const WORKSPACE_CONCURRENCY = 4;

/** What `activate` returns — used by the integration tests, and not a public contract. */
export interface SlopSquatShieldApi {
  /** Scans one manifest now (no debounce) and publishes its diagnostics. */
  scanNow(uri: vscode.Uri): Promise<Finding[]>;
  findings(uri: vscode.Uri): readonly Finding[];
  /** Replaces the network `fetch` the engine uses, so tests never touch a real registry. */
  setFetchImplForTests(fetchImpl: typeof fetch | undefined): void;
  /** How many scans have started — lets tests assert that debouncing coalesced them. */
  scansStarted(): number;
}

function toRange(range: Finding['range']): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

/**
 * The advisory editor surface (§5A, FR-19). It never enforces anything — it shows what core
 * finds, in the open manifest, as it is edited. All detection lives in `packages/core`.
 */
class Controller implements vscode.CodeActionProvider, vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('slopsquatshield');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  // In-memory, not SQLite: a native module can't ship to every editor's Electron.
  private readonly output = vscode.window.createOutputChannel('SlopSquatShield');
  private readonly warned = new Set<string>();
  private readonly cache: FactCache = new MemoryCache();
  /** Shared by every scan, so opening a workspace with many manifests is not a burst of requests. */
  private readonly limit = createScanLimit();
  private readonly results = new Map<string, Finding[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generation = new Map<string, number>();
  private readonly disposables: vscode.Disposable[] = [];
  private fetchImpl: typeof fetch | undefined;
  private scanning = 0;
  scansStarted = 0;

  constructor() {
    this.status.command = 'workbench.actions.view.problems';
    this.disposables.push(this.diagnostics, this.status, this.output);
    this.output.appendLine(CREDIT);
    this.refreshStatus();
    this.status.show();
  }

  setFetch(fetchImpl: typeof fetch | undefined): void {
    this.fetchImpl = fetchImpl;
    this.cache.close(); // a MemoryCache survives close(); a new fetch should still see fresh data
  }

  private get enabled(): boolean {
    return vscode.workspace.getConfiguration('slopsquatshield').get<boolean>('enable', true);
  }

  private get debounceMs(): number {
    return vscode.workspace.getConfiguration('slopsquatshield').get<number>('debounceMs', 500);
  }

  findings(uri: vscode.Uri): readonly Finding[] {
    return this.results.get(uri.toString()) ?? [];
  }

  // ---- scheduling ------------------------------------------------------------------------

  /** FR-19.1: scan on open/save, debounced per file. */
  schedule(uri: vscode.Uri): void {
    if (!this.enabled || uri.scheme !== 'file' || !isSupportedManifest(uri.fsPath)) return;
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.scan(uri);
      }, this.debounceMs),
    );
  }

  async scan(uri: vscode.Uri): Promise<Finding[]> {
    if (!this.enabled) return [];
    const key = uri.toString();
    const generation = (this.generation.get(key) ?? 0) + 1;
    this.generation.set(key, generation);

    this.scansStarted++;
    this.scanning++;
    this.refreshStatus();
    try {
      const text = await this.readText(uri);
      const findings = await scanManifest({
        fileName: uri.fsPath,
        text,
        allowlistText: await this.readAllowlist(uri),
        configInputs: await this.readConfigInputs(uri),
        onConfigWarning: (message) => this.warnOnce(message),
        cache: this.cache,
        fetchImpl: this.fetchImpl,
        limit: this.limit,
      });
      // A newer scan of the same file superseded this one while it was awaiting the network.
      if (this.generation.get(key) === generation) this.publish(uri, findings);
      return findings;
    } catch {
      return []; // advisory surface: a failure here must never surface as an error popup
    } finally {
      this.scanning--;
      this.refreshStatus();
    }
  }

  private publish(uri: vscode.Uri, findings: Finding[]): void {
    this.results.set(uri.toString(), findings);
    this.diagnostics.set(
      uri,
      findings.map((f) => {
        const diagnostic = new vscode.Diagnostic(toRange(f.range), f.message, SEVERITY[f.severity]);
        diagnostic.source = SOURCE;
        diagnostic.code = f.kind;
        return diagnostic;
      }),
    );
  }

  /** Scans every manifest in the workspace (FR-19.3's aggregate), a few at a time. */
  async scanWorkspace(): Promise<void> {
    if (!this.enabled) return;
    const uris = await vscode.workspace.findFiles(
      MANIFEST_GLOB,
      EXCLUDE_GLOB,
      MAX_WORKSPACE_MANIFESTS,
    );
    const queue = [...uris];
    const worker = async (): Promise<void> => {
      for (let uri = queue.shift(); uri; uri = queue.shift()) await this.scan(uri);
    };
    await Promise.all(Array.from({ length: WORKSPACE_CONCURRENCY }, worker));
  }

  /** Rescans everything already known — used when the allowlist or the settings change. */
  rescanKnown(): void {
    for (const key of this.results.keys()) this.schedule(vscode.Uri.parse(key));
  }

  forget(uri: vscode.Uri): void {
    this.results.delete(uri.toString());
    this.diagnostics.delete(uri);
    this.refreshStatus();
  }

  clearAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.results.clear();
    this.diagnostics.clear();
    this.refreshStatus();
  }

  private refreshStatus(): void {
    const all = [...this.results.values()].flat();
    const summary = summarize(all, this.scanning > 0);
    this.status.text = summary.text;
    this.status.tooltip = summary.tooltip;
  }

  // ---- files -----------------------------------------------------------------------------

  private async readText(uri: vscode.Uri): Promise<string> {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) return open.getText(); // includes unsaved edits
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  }

  /**
   * The manifest's own directory — where the CLI, shell wrapper and hooks look for
   * `.slopsquatshield` / `.slopsquatshieldrc` (they read them from the directory the install runs in).
   * Not the workspace-folder root: with a parent folder or a monorepo open, that put the allowlist
   * somewhere the install path never reads, so the editor said "allowed" and `npm install` warned.
   * Still `undefined` for a manifest outside every workspace folder, as before.
   */
  private projectDir(manifest: vscode.Uri): vscode.Uri | undefined {
    if (!vscode.workspace.getWorkspaceFolder(manifest)) return undefined;
    return vscode.Uri.joinPath(manifest, '..');
  }

  private allowlistUri(manifest: vscode.Uri): vscode.Uri | undefined {
    const dir = this.projectDir(manifest);
    return dir ? vscode.Uri.joinPath(dir, '.slopsquatshield') : undefined;
  }

  private async readAllowlist(manifest: vscode.Uri): Promise<string | undefined> {
    const uri = this.allowlistUri(manifest);
    if (!uri) return undefined;
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      return undefined; // no allowlist file is the normal case
    }
  }

  /** A bad project config falls back to defaults (NFR-3.1) — say so once, in the output channel. */
  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.output.appendLine(message);
  }

  /** `.slopsquatshieldrc` and the project's `package.json` (its `slopsquatshield` key can hold the config). */
  private async readConfigInputs(manifest: vscode.Uri) {
    const dir = this.projectDir(manifest);
    if (!dir) return undefined;
    const read = async (name: string) => {
      const uri = vscode.Uri.joinPath(dir, name);
      try {
        return {
          fileName: uri.fsPath,
          text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
        };
      } catch {
        return undefined;
      }
    };
    return { rc: await read('.slopsquatshieldrc'), packageJson: await read('package.json') };
  }

  /** FR-19.2's "add to allowlist" — the same `appendToAllowlist` transform the CLI's `allow` uses. */
  async addToAllowlist(manifest: vscode.Uri, identifier: string): Promise<void> {
    const uri = this.allowlistUri(manifest);
    if (!uri) {
      void vscode.window.showWarningMessage('SlopSquatShield: open a folder to keep an allowlist.');
      return;
    }
    const current = await this.readAllowlist(manifest);
    if (current !== undefined && parseAllowlist(current).has(identifier)) {
      void vscode.window.showInformationMessage(
        `SlopSquatShield: ${identifier} is already in ${uri.fsPath}.`,
      );
      return;
    }
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(appendToAllowlist(current, identifier)),
    );
    void vscode.window.showInformationMessage(
      `SlopSquatShield: added ${identifier} to ${uri.fsPath}.`,
    );
    this.rescanKnown();
  }

  // ---- quick fixes (FR-19.2) -------------------------------------------------------------

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const findings = this.findings(document.uri);
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== SOURCE) continue;
      const finding = findings.find(
        (f) => f.kind === diagnostic.code && toRange(f.range).isEqual(diagnostic.range),
      );
      if (!finding) continue;

      for (const fix of quickFixesFor(finding, document.getText())) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        if (fix.edits) {
          action.edit = new vscode.WorkspaceEdit();
          for (const edit of fix.edits)
            action.edit.replace(document.uri, toRange(edit.range), edit.newText);
        }
        if (fix.allowIdentifier) {
          action.command = {
            command: 'slopsquatshield.addToAllowlist',
            title: fix.title,
            arguments: [document.uri, fix.allowIdentifier],
          };
        }
        actions.push(action);
      }
    }
    return actions;
  }

  addDisposable(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const disposable of this.disposables) disposable.dispose();
  }
}

export function activate(context: vscode.ExtensionContext): SlopSquatShieldApi {
  setUserAgent(
    'slopsquatshield-vscode',
    typeof __SSG_VERSION__ === 'string' ? __SSG_VERSION__ : '0.0.0-dev',
  );
  const controller = new Controller();
  context.subscriptions.push(controller);

  // FR-19.1: open, save (debounced), plus whatever is already open at activation.
  controller.addDisposable(
    vscode.workspace.onDidOpenTextDocument((doc) => controller.schedule(doc.uri)),
  );
  controller.addDisposable(
    vscode.workspace.onDidSaveTextDocument((doc) => controller.schedule(doc.uri)),
  );
  controller.addDisposable(
    vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) controller.forget(uri);
    }),
  );
  for (const doc of vscode.workspace.textDocuments) controller.schedule(doc.uri);

  // The allowlist is shared state (FR-5.2): changing it re-evaluates everything.
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/{.slopsquatshield,.slopsquatshieldrc}',
  );
  controller.addDisposable(watcher);
  for (const event of [watcher.onDidCreate, watcher.onDidChange, watcher.onDidDelete]) {
    controller.addDisposable(event(() => controller.rescanKnown()));
  }

  controller.addDisposable(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('slopsquatshield')) return;
      controller.clearAll();
      void controller.scanWorkspace();
    }),
  );

  controller.addDisposable(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', pattern: MANIFEST_GLOB },
      controller,
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
  );
  controller.addDisposable(
    vscode.commands.registerCommand('slopsquatshield.scanWorkspace', () =>
      controller.scanWorkspace(),
    ),
  );
  controller.addDisposable(
    vscode.commands.registerCommand(
      'slopsquatshield.addToAllowlist',
      (uri: vscode.Uri, identifier: string) => controller.addToAllowlist(uri, identifier),
    ),
  );

  void controller.scanWorkspace();

  return {
    scanNow: (uri) => controller.scan(uri),
    findings: (uri) => controller.findings(uri),
    setFetchImplForTests: (fetchImpl) => controller.setFetch(fetchImpl),
    scansStarted: () => controller.scansStarted,
  };
}

export function deactivate(): void {}
