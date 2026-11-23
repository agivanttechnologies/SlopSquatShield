// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
/**
 * A minimal in-memory stand-in for the `vscode` module — just the surface `extension.ts` uses —
 * so the extension's real activation path (debounce, diagnostics, status bar, quick fixes) can
 * be exercised under Vitest without launching an editor. It is aliased in as `vscode` by the
 * root vitest config. Anything the extension doesn't touch is deliberately not implemented.
 */
import { posix } from 'node:path';

export class Position {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export class Range {
  start: Position;
  end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === 'number') {
      this.start = new Position(a, b as number);
      this.end = new Position(c as number, d as number);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
  isEqual(other: Range): boolean {
    return (
      this.start.line === other.start.line &&
      this.start.character === other.start.character &&
      this.end.line === other.end.line &&
      this.end.character === other.end.character
    );
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  source?: string;
  code?: unknown;
  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  ) {}
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly fsPath: string,
  ) {}
  static file(path: string): Uri {
    return new Uri('file', path);
  }
  static parse(value: string): Uri {
    const match = /^([a-z]+):\/\/(.*)$/.exec(value);
    if (!match) return new Uri('file', value);
    return new Uri(match[1], decodeURIComponent(match[2]));
  }
  // Like the real one, `..` and `.` segments are resolved (posix rules).
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, posix.join(base.fsPath, ...segments));
  }
  get path(): string {
    return this.fsPath;
  }
  // Must round-trip through `parse`, as the real Uri does (`rescanKnown` relies on it). Node's
  // `pathToFileURL` resolved `/ws/x` against the current drive on Windows (`file:///D:/ws/x`),
  // so a parsed-back Uri pointed at a file the fake filesystem doesn't have.
  toString(): string {
    return `${this.scheme}://${encodeURI(this.fsPath)}`;
  }
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class CodeAction {
  diagnostics?: Diagnostic[];
  edit?: WorkspaceEdit;
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(
    public title: string,
    public kind?: unknown,
  ) {}
}
export const CodeActionKind = { QuickFix: 'quickfix' };

export class WorkspaceEdit {
  edits: Array<{ uri: Uri; range: Range; newText: string }> = [];
  replace(uri: Uri, range: Range, newText: string): void {
    this.edits.push({ uri, range, newText });
  }
}

class Emitter<T> {
  listeners: Array<(value: T) => void> = [];
  event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(value: T): void {
    for (const l of [...this.listeners]) l(value);
  }
}

// ---- observable state, reset between tests ---------------------------------------------
export const state = {
  files: new Map<string, string>(),
  config: new Map<string, unknown>(),
  openDocuments: [] as Array<{ uri: Uri; getText(): string }>,
  collections: [] as FakeCollection[],
  statusItems: [] as Array<{ text: string; tooltip?: string; command?: string }>,
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  codeActionProviders: [] as Array<{
    provideCodeActions(doc: unknown, range: unknown, ctx: unknown): CodeAction[];
  }>,
  warnings: [] as string[],
  infos: [] as string[],
  output: [] as string[],
  workspaceRoot: '/ws',
};

export function reset(): void {
  state.files.clear();
  state.config.clear();
  state.openDocuments = [];
  state.collections = [];
  state.statusItems = [];
  state.commands.clear();
  state.codeActionProviders = [];
  state.warnings = [];
  state.infos = [];
  state.output = [];
  for (const e of Object.values(emitters)) e.listeners = [];
}

const emitters = {
  open: new Emitter<{ uri: Uri }>(),
  save: new Emitter<{ uri: Uri }>(),
  deleted: new Emitter<{ files: Uri[] }>(),
  config: new Emitter<{ affectsConfiguration(section: string): boolean }>(),
  watcherCreate: new Emitter<Uri>(),
  watcherChange: new Emitter<Uri>(),
  watcherDelete: new Emitter<Uri>(),
};
export const fire = {
  open: (uri: Uri) => emitters.open.fire({ uri }),
  save: (uri: Uri) => emitters.save.fire({ uri }),
  deleted: (...files: Uri[]) => emitters.deleted.fire({ files }),
  config: () => emitters.config.fire({ affectsConfiguration: () => true }),
  allowlistChanged: () =>
    emitters.watcherChange.fire(Uri.file(`${state.workspaceRoot}/.slopsquatshield`)),
};

class FakeCollection {
  readonly entries = new Map<string, Diagnostic[]>();
  set(uri: Uri, diagnostics: Diagnostic[]): void {
    this.entries.set(uri.toString(), diagnostics);
  }
  delete(uri: Uri): void {
    this.entries.delete(uri.toString());
  }
  clear(): void {
    this.entries.clear();
  }
  get(uri: Uri): Diagnostic[] {
    return this.entries.get(uri.toString()) ?? [];
  }
  dispose(): void {}
}

const MANIFEST = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Pipfile|pom\.xml)$/;

export const languages = {
  createDiagnosticCollection(): FakeCollection {
    const c = new FakeCollection();
    state.collections.push(c);
    return c;
  },
  registerCodeActionsProvider(_selector: unknown, provider: (typeof state.codeActionProviders)[0]) {
    state.codeActionProviders.push(provider);
    return { dispose: () => {} };
  },
};

export const window = {
  createStatusBarItem() {
    const item = {
      text: '',
      tooltip: undefined as string | undefined,
      command: undefined as string | undefined,
      show() {},
      dispose() {},
    };
    state.statusItems.push(item);
    return item;
  },
  createOutputChannel() {
    return {
      lines: [] as string[],
      appendLine(line: string) {
        this.lines.push(line);
        state.output.push(line);
      },
      dispose() {},
    };
  },
  showWarningMessage(message: string) {
    state.warnings.push(message);
    return Promise.resolve(undefined);
  },
  showInformationMessage(message: string) {
    state.infos.push(message);
    return Promise.resolve(undefined);
  },
};

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    state.commands.set(id, handler);
    return { dispose: () => {} };
  },
};

export const workspace = {
  get textDocuments() {
    return state.openDocuments;
  },
  getConfiguration(section: string) {
    return {
      get: <T>(key: string, fallback: T): T =>
        (state.config.has(`${section}.${key}`)
          ? state.config.get(`${section}.${key}`)
          : fallback) as T,
    };
  },
  onDidOpenTextDocument: (l: (d: { uri: Uri }) => void) => emitters.open.event((e) => l(e)),
  onDidSaveTextDocument: (l: (d: { uri: Uri }) => void) => emitters.save.event((e) => l(e)),
  onDidDeleteFiles: emitters.deleted.event,
  onDidChangeConfiguration: emitters.config.event,
  createFileSystemWatcher() {
    return {
      onDidCreate: emitters.watcherCreate.event,
      onDidChange: emitters.watcherChange.event,
      onDidDelete: emitters.watcherDelete.event,
      dispose() {},
    };
  },
  getWorkspaceFolder: () => ({ uri: Uri.file(state.workspaceRoot) }),
  findFiles: async () =>
    [...state.files.keys()].filter((p) => MANIFEST.test(p)).map((p) => Uri.file(p)),
  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      const text = state.files.get(uri.fsPath);
      if (text === undefined) throw new Error(`ENOENT: ${uri.fsPath}`);
      return new TextEncoder().encode(text);
    },
    async writeFile(uri: Uri, bytes: Uint8Array): Promise<void> {
      state.files.set(uri.fsPath, new TextDecoder().decode(bytes));
    },
  },
};
