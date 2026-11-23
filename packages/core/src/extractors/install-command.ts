// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { isAbsolute, join, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { resolveNpmAlias } from './npm.js';
import { parseRequirementString } from './python/requirements.js';
import type { Ecosystem, ExtractedDependency } from './types.js';

const xmlParser = new XMLParser({ ignoreAttributes: true });

// Flags whose value is the next token (`--prefix ~/tools`, `-w packages/cli`, `-i https://…`,
// `-r requirements.txt`). Dropping only the flag left its value behind as a "package name", so the
// hook denied ordinary commands. `--flag=value` is a single token and needs no entry here.
const NPM_VALUE_FLAGS = new Set([
  '-C',
  '--prefix',
  '-w',
  '--workspace',
  '--tag',
  '--registry',
  '--cache',
  '--userconfig',
  '--globalconfig',
  '--save-prefix',
  '--loglevel',
  '--omit',
  '--include',
  '--install-strategy',
  '--before',
  '--cpu',
  '--os',
  '--libc',
  '--otp',
  '--scope',
]);

// pip, plus `uv add` / `uv pip install`. -r/-e name a file, path or VCS URL, never a registry name.
const PIP_VALUE_FLAGS = new Set([
  '-r',
  '--requirement',
  '-e',
  '--editable',
  '-c',
  '--constraint',
  '-t',
  '--target',
  '-i',
  '--index-url',
  '--extra-index-url',
  '-f',
  '--find-links',
  '--root',
  '--prefix',
  '--src',
  '--platform',
  '--python-version',
  '--implementation',
  '--abi',
  '--trusted-host',
  '--cache-dir',
  '--log',
  '--proxy',
  '--cert',
  '--client-cert',
  '--retries',
  '--timeout',
  '--exists-action',
  '--progress-bar',
  '--upgrade-strategy',
  '--only-binary',
  '--no-binary',
  '-C',
  '--config-settings',
  '--report',
  '--python',
  '-p',
  '--group',
  '--optional',
  '--extra',
  '--index',
  '--default-index',
  '--package',
  '--directory',
  '--project',
  '--branch',
  '--rev',
  '--bounds',
  '--script',
  '-m',
  '--marker',
]);

const POETRY_VALUE_FLAGS = new Set([
  '-G',
  '--group',
  '-E',
  '--extras',
  '--source',
  '--python',
  '--platform',
  '--markers',
  '-C',
  '--directory',
  '-P',
  '--project',
]);

type LineHandler = (argsText: string, source: string) => ExtractedDependency[];

const LINE_MATCHERS: { re: RegExp; handler: LineHandler }[] = [
  { re: /^npm\s+(?:install|i|add)\s+(.+)$/, handler: extractNpmLine },
  { re: /^(?:pip|pip3)\s+install\s+(.+)$/, handler: extractPipLikeLine },
  { re: /^uv\s+(?:add|pip\s+install)\s+(.+)$/, handler: extractPipLikeLine },
  { re: /^poetry\s+add\s+(.+)$/, handler: extractPoetryLine },
  { re: /^mvn\s+dependency:get\s+(.+)$/, handler: extractMvnLine },
];

// Matches a bare word, or a "..."/'...' quoted span (so a version range with commas
// or spaces inside stays one token) — same shape a shell's own tokenizer would produce.
const TOKEN_RE = /"([^"]+)"|'([^']+)'|(\S+)/g;

// ---- shell command segmentation ------------------------------------------------------------
// A line of shell can hold several commands (`cd app && npm install foo | tail`). Matching only
// at the start of a line missed every install that wasn't first (`cd app && npm install ghost`
// was never checked — a hook bypass) and, once matched, swallowed the operators after it as
// package names. So each line is cut into command segments the way a shell would see them.

const SEGMENT_BREAKS = new Set([';', '|', '&', '(', ')', '{', '}', '`', '\n']);

/** Drops a trailing file-descriptor number left behind by a redirection like `2>&1`. */
function stripTrailingFd(segment: string): string {
  return segment.replace(/(^|\s)\d+$/, '$1');
}

/** Markers {@link splitCommandSegments} emits where an unquoted subshell `(` or `$(` opens or `)` closes. */
const SUBSHELL_OPEN = '(';
const SUBSHELL_CLOSE = ')';

/**
 * Splits one line into its simple commands: breaks at unquoted `;`, `|`, `||`, `&`, `&&`,
 * parentheses, braces and backticks, and cuts each command off at its first unquoted redirection
 * (`>`, `<`, `2>&1`, `&>file`). Quoted text is left intact, so `echo "npm install x"` is one
 * `echo` command and a version range like `"a@^1 || ^2"` stays a single token.
 *
 * Unquoted `(` and `)` are also emitted as the {@link SUBSHELL_OPEN}/{@link SUBSHELL_CLOSE}
 * markers (a real segment never equals either, since parentheses always break), so the caller can
 * undo a `cd` made inside `( … )` or `$( … )` when the subshell ends.
 */
function splitCommandSegments(line: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let redirected = false;

  const flush = () => {
    const trimmed = (redirected ? stripTrailingFd(current) : current).trim();
    if (trimmed) segments.push(trimmed);
    current = '';
    redirected = false;
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === '\\' && quote === '"') {
        if (!redirected) current += c + (line[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === quote) quote = undefined;
      if (!redirected) current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      if (!redirected) current += c;
      continue;
    }
    if (c === '>' || c === '<') {
      redirected = true; // everything up to the next command break is a redirect target
      continue;
    }
    if (c === '&' && (line[i + 1] === '>' || line[i - 1] === '>')) {
      continue; // part of `2>&1` / `&>file`, not a command separator
    }
    if (SEGMENT_BREAKS.has(c)) {
      flush();
      if (c === '(') segments.push(SUBSHELL_OPEN);
      else if (c === ')') segments.push(SUBSHELL_CLOSE);
      continue;
    }
    if (!redirected) current += c;
  }
  flush();
  return segments;
}

/** `<< EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"` — but not the here-string `<<<`. */
const HEREDOC_OPENER = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;

/** Commands whose heredoc body is itself executed as shell, so its lines still count. */
const SHELL_INTERPRETER = /(?:^|[\s;|&(])(?:bash|sh|zsh|dash|ksh|source|eval)(?:\s|$)/;

/** Removes `VAR=value` assignments and transparent wrappers (`sudo`, `time`, …) before the command. */
function stripCommandPrefixes(segment: string): string {
  let text = segment;
  for (;;) {
    const next = text
      .replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/, '')
      .replace(/^(?:sudo|time|command|exec|nohup|env|nice)\s+(?:-\S+\s+)*/, '');
    if (next === text) return text;
    text = next;
  }
}

/**
 * `python -m pip …` runs pip. Any interpreter spelling: `python`, `python3`, `python3.12`, the
 * Windows `py` launcher, with a path (`.venv/bin/python`) or `.exe`, and with interpreter flags
 * before `-m` (`python -I -m pip`, `py -3.12 -m pip`). Without this, an agent that installs with
 * `python -m pip install ghost` was never checked (a hook bypass).
 */
const PYTHON_DASH_M_PIP =
  /^(?:\S*[\\/])?(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?\s+(?:-[A-Za-z0-9.]+\s+)*-m\s+pip3?(?=\s|$)/;

/**
 * npm accepts its options before the subcommand (`npm --prefix x install ghost`), but every
 * matcher here expects `npm <subcommand>` first, so such a command was never checked (a hook
 * bypass). Moves the leading options to just after the subcommand, keeping each token's raw text
 * (quotes included): `npm --prefix x install ghost` → `npm install --prefix x ghost`.
 */
function hoistNpmLeadingOptions(command: string): string {
  const head = /^npm\s+/.exec(command);
  if (!head) return command;
  const rest = command.slice(head[0].length);
  const raw = [...rest.matchAll(TOKEN_RE)].map((m) => ({
    text: m[0],
    value: m[1] ?? m[2] ?? m[3],
    end: (m.index ?? 0) + m[0].length,
  }));
  const options: string[] = [];
  let i = 0;
  while (i < raw.length && raw[i].value.startsWith('-')) {
    const token = raw[i];
    options.push(token.text);
    i++;
    if (!token.value.includes('=') && NPM_VALUE_FLAGS.has(token.value) && i < raw.length) {
      options.push(raw[i].text);
      i++;
    }
  }
  if (options.length === 0 || i >= raw.length) return command;
  const subcommand = raw[i].text;
  const after = rest.slice(raw[i].end).trim();
  return ['npm', subcommand, ...options, after].filter(Boolean).join(' ');
}

/** The package managers the matchers know, by the bare name each one is matched under. */
const TOOL_ALIASES: Record<string, string> = {
  npm: 'npm',
  pip: 'pip',
  pip3: 'pip3',
  uv: 'uv',
  poetry: 'poetry',
  pipenv: 'pipenv',
  mvn: 'mvn',
  mvnw: 'mvn',
};

/**
 * Reduces the command's first word to a bare tool name when it is a known package manager spelled
 * another way: by path (`.venv/bin/pip`, `/usr/bin/npm`, `./mvnw`), with a Windows extension
 * (`pip.exe`, `npm.cmd`, `mvnw.cmd`), quoted (`"C:\Program Files\nodejs\npm.cmd"`), or versioned
 * (`pip3.12`). Each of these used to skip every check (a hook bypass): agents commonly call a
 * virtualenv's own `pip` by path. Any other first word is left alone.
 */
function normalizeToolName(command: string): string {
  const first = /^(?:"([^"]+)"|'([^']+)'|(\S+))(?=\s|$)/.exec(command);
  if (!first) return command;
  const word = first[1] ?? first[2] ?? first[3];
  // Case-insensitive: on Windows and macOS `NPM.CMD` runs npm, and checking too much is the safe side.
  let base = (word.split(/[\\/]/).pop() ?? word)
    .replace(/\.(?:exe|cmd|bat|ps1)$/i, '')
    .toLowerCase();
  if (/^pip\d+(?:\.\d+)*$/.test(base)) base = 'pip';
  const tool = TOOL_ALIASES[base];
  if (tool === undefined || first[0] === tool) return command;
  return tool + command.slice(first[0].length);
}

/** Rewrites equivalent spellings of an install into the form the matchers below recognise. */
function normalizeInvocation(command: string): string {
  return hoistNpmLeadingOptions(normalizeToolName(command.replace(PYTHON_DASH_M_PIP, 'pip')));
}

function tokenize(argsText: string): string[] {
  const tokens: string[] = [];
  for (const match of argsText.matchAll(TOKEN_RE)) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

/** The arguments that are not options, nor the value of an option that takes one. */
function positionalArgs(tokens: string[], valueFlags: ReadonlySet<string>): string[] {
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (token.startsWith('-')) {
      if (!token.includes('=') && valueFlags.has(token)) i++;
      continue;
    }
    positional.push(token);
  }
  return positional;
}

function isPathOrUrlLike(token: string): boolean {
  return (
    token.startsWith('.') ||
    token.startsWith('/') ||
    token.startsWith('~') ||
    token.includes('://') ||
    token.startsWith('git+') ||
    token.endsWith('.tgz')
  );
}

/** `name@spec` → its parts; `alias@npm:real@spec` → the real package (see {@link resolveNpmAlias}). */
function parseNpmSpecifier(token: string): { name: string; specifier?: string; alias?: string } {
  const atIndex = token.startsWith('@') ? token.indexOf('@', 1) : token.indexOf('@');
  if (atIndex === -1) return { name: token };
  return resolveNpmAlias(token.slice(0, atIndex), token.slice(atIndex + 1) || undefined);
}

function extractNpmLine(argsText: string, source: string): ExtractedDependency[] {
  const tokens = positionalArgs(tokenize(argsText), NPM_VALUE_FLAGS).filter(
    (t) => !isPathOrUrlLike(t),
  );
  return tokens.map((token) => {
    const { name, specifier, alias } = parseNpmSpecifier(token);
    const dep: ExtractedDependency = { name, ecosystem: 'npm', specifier, source };
    if (alias !== undefined) dep.alias = alias;
    return dep;
  });
}

function extractPipLikeLine(argsText: string, source: string): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];
  for (const token of positionalArgs(tokenize(argsText), PIP_VALUE_FLAGS)) {
    const parsed = parseRequirementString(token);
    if (!parsed) continue;
    deps.push({
      name: parsed.name,
      ecosystem: 'pypi',
      specifier: parsed.specifier,
      extras: parsed.extras,
      source,
    });
  }
  return deps;
}

// Poetry pins with "name[extras]@specifier" rather than pip's "name[extras]==specifier".
const POETRY_TOKEN_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]*)\])?(?:@(.+))?$/;

function extractPoetryLine(argsText: string, source: string): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];
  for (const token of positionalArgs(tokenize(argsText), POETRY_VALUE_FLAGS)) {
    const match = POETRY_TOKEN_RE.exec(token);
    if (!match) continue;
    const [, name, extrasRaw, specifier] = match;
    const extras = extrasRaw
      ? extrasRaw
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean)
      : undefined;
    deps.push({ name, ecosystem: 'pypi', specifier: specifier || undefined, extras, source });
  }
  return deps;
}

function extractMvnLine(argsText: string, source: string): ExtractedDependency[] {
  const match = /-Dartifact=(\S+)/.exec(argsText);
  if (!match) return [];

  const [groupId, artifactId, version] = match[1].split(':');
  if (!groupId || !artifactId) return [];

  return [{ name: `${groupId}:${artifactId}`, ecosystem: 'maven', specifier: version, source }];
}

interface DependencyXmlBlock {
  groupId?: string;
  artifactId?: string;
  version?: string;
}

function extractXmlDependencyBlocks(text: string, source: string): ExtractedDependency[] {
  const deps: ExtractedDependency[] = [];
  const blocks = text.match(/<dependency>[\s\S]*?<\/dependency>/g) ?? [];

  for (const block of blocks) {
    const doc = xmlParser.parse(`<root>${block}</root>`) as {
      root?: { dependency?: DependencyXmlBlock };
    };
    const dep = doc.root?.dependency;
    if (!dep?.groupId || !dep?.artifactId) continue;
    deps.push({
      name: `${dep.groupId}:${dep.artifactId}`,
      ecosystem: 'maven',
      specifier: dep.version,
      source,
    });
  }

  return deps;
}

// ---- manifest-driven installs ---------------------------------------------------------------
// `npm install`, `npm ci`, `pip install -r requirements.txt`, `uv sync`, `mvn test` name no package
// on the command line, yet they install everything the project's manifest lists. An agent that
// edits package.json with its file tool and then runs one of these bypassed every check, so the
// classifier reports them too — as `ManifestInstall`s the caller resolves against the project.

export type ManifestInstallTool = 'npm' | 'pip' | 'uv' | 'poetry' | 'pipenv' | 'mvn';

/** An install command that installs what a manifest lists rather than a package it names. */
export interface ManifestInstall {
  tool: ManifestInstallTool;
  ecosystem: Ecosystem;
  /**
   * Absolute directory the command runs in (after any `cd`, `-C`, `--prefix`, `--directory`).
   * `undefined` when it cannot be known statically — `cd "$X"`, `cd -`, or no `cwd` was given.
   */
  projectDir: string | undefined;
  /** Exact files the command names (`pip install -r f`, `mvn -f pom.xml`), absolute; else the tool's own manifest in `projectDir`. */
  files?: string[];
  /** The command, for messages. */
  command: string;
}

export interface InstallCommandClassification {
  /** Packages named on the command line — what `extractInstallCommandDeps` has always returned. */
  named: ExtractedDependency[];
  /** Installs driven by a manifest, with the directory each one runs in. */
  manifestInstalls: ManifestInstall[];
}

export interface ClassifyInstallOptions {
  source?: string;
  includeXmlBlocks?: boolean;
  /** Directory the command runs in; `cd` is tracked from here. */
  cwd?: string;
  /** For `cd`, `cd ~` and `~/…`. */
  homeDir?: string;
}

/** True when `token` is a dynamic path the shell would expand — it cannot be resolved statically. */
function isDynamicPath(token: string): boolean {
  return /[$`*?]/.test(token);
}

/** Resolves a path argument against the current directory; `undefined` when it can't be known. */
function resolveDirArg(
  dir: string | undefined,
  value: string,
  homeDir: string | undefined,
): string | undefined {
  if (isDynamicPath(value)) return undefined;
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return homeDir ? join(homeDir, value.slice(2)) : undefined;
  if (isAbsolute(value)) return value;
  return dir ? resolve(dir, value) : undefined;
}

/**
 * Tracks `cd`/`pushd`/`popd` so a later install is attributed to the right directory
 * (`cd app && npm ci`). Returns the new directory, or `'unchanged'` for any other command.
 * Subshell `( … )` boundaries are handled by the caller, which restores the directory at `)`.
 */
function applyCd(
  dir: string | undefined,
  command: string,
  homeDir: string | undefined,
): string | undefined | 'unchanged' {
  if (/^popd(?:\s|$)/.test(command)) return undefined;
  const match = /^(?:cd|pushd)(?:\s+(.*))?$/.exec(command);
  if (!match) return 'unchanged';
  const tokens = tokenize(match[1] ?? '').filter(
    (t) => !['--', '-P', '-L', '-e', '-@'].includes(t),
  );
  const target = tokens[0];
  if (target === undefined) return homeDir; // bare `cd` goes home
  if (target === '-') return undefined; // the previous directory — not knowable here
  return resolveDirArg(dir, target, homeDir);
}

/** The value of an option given as `flag value`, `flag=value`, or (for short flags) `-Xvalue`. */
function optionValues(tokens: string[], flags: readonly string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    for (const flag of flags) {
      if (token === flag) {
        const next = tokens[i + 1];
        if (next !== undefined) values.push(next);
      } else if (token.startsWith(`${flag}=`)) {
        values.push(token.slice(flag.length + 1));
      } else if (flag.length === 2 && !flag.startsWith('--') && token.startsWith(flag)) {
        values.push(token.slice(flag.length));
      }
    }
  }
  return values;
}

const NPM_MANIFEST_RE = /^npm\s+(?:install|i|add|ci|install-clean|update|up|upgrade)(?:\s+(.*))?$/;
const PIP_MANIFEST_RE = /^(?:pip|pip3)\s+install(?:\s+(.*))?$/;
const UV_MANIFEST_RE = /^uv\s+(add|sync|pip\s+install|pip\s+sync)(?:\s+(.*))?$/;
const POETRY_MANIFEST_RE = /^poetry\s+(?:add|install)(?:\s+(.*))?$/;
const PIPENV_MANIFEST_RE = /^pipenv\s+(?:install|sync)(?:\s+(.*))?$/;
const MVN_MANIFEST_RE = /^(?:mvn|mvnw|\.\/mvnw)\s+(.*)$/;

const MVN_VALUE_FLAGS = new Set([
  '-f',
  '--file',
  '-s',
  '--settings',
  '-gs',
  '--global-settings',
  '-P',
  '--activate-profiles',
  '-pl',
  '--projects',
  '-rf',
  '--resume-from',
  '-T',
  '--threads',
  '-l',
  '--log-file',
  '-b',
  '--builder',
  '-t',
  '--toolchains',
]);

/** Goals that never resolve dependencies. */
function isNonResolvingGoal(goal: string): boolean {
  return goal === 'clean' || goal === 'validate' || goal.startsWith('help:');
}

/** `pip install .` / `-e dir`: a directory argument means "install that project". */
function isProjectDirArg(token: string): boolean {
  if (/\.(?:whl|zip|tar|tgz|gz|bz2|xz)$/i.test(token)) return false;
  return token === '.' || token.startsWith('./') || token.startsWith('../') || token === '..';
}

function pipLikeInstalls(
  tool: 'pip' | 'uv',
  argsText: string,
  dir: string | undefined,
  homeDir: string | undefined,
  command: string,
  filesArePositional = false,
): ManifestInstall[] {
  const tokens = tokenize(argsText);
  const files = (
    filesArePositional
      ? positionalArgs(tokens, PIP_VALUE_FLAGS)
      : optionValues(tokens, ['-r', '--requirement'])
  )
    .map((f) => resolveDirArg(dir, f, homeDir))
    .filter((f): f is string => f !== undefined);
  const unresolved =
    (filesArePositional
      ? positionalArgs(tokens, PIP_VALUE_FLAGS)
      : optionValues(tokens, ['-r', '--requirement'])
    ).length - files.length;

  const installs: ManifestInstall[] = [];
  if (files.length > 0 || unresolved > 0) {
    installs.push({
      tool,
      ecosystem: 'pypi',
      projectDir: files.length > 0 ? dir : undefined,
      files,
      command,
    });
  }
  const dirArgs = [
    ...positionalArgs(tokens, PIP_VALUE_FLAGS).filter(isProjectDirArg),
    ...optionValues(tokens, ['-e', '--editable']).filter(isProjectDirArg),
  ];
  for (const arg of dirArgs) {
    installs.push({
      tool,
      ecosystem: 'pypi',
      projectDir: resolveDirArg(dir, arg, homeDir),
      command,
    });
  }
  return installs;
}

function detectManifestInstalls(
  command: string,
  dir: string | undefined,
  homeDir: string | undefined,
): ManifestInstall[] {
  const label = command.length > 200 ? `${command.slice(0, 200)}…` : command;

  const npm = NPM_MANIFEST_RE.exec(command);
  if (npm) {
    const tokens = tokenize(npm[1] ?? '');
    // `npm install -g x` installs that package alone, outside any project.
    if (tokens.some((t) => t === '--global' || (/^-[A-Za-z]+$/.test(t) && t.includes('g'))))
      return [];
    const override = optionValues(tokens, ['-C', '--prefix'])[0];
    const projectDir = override !== undefined ? resolveDirArg(dir, override, homeDir) : dir;
    return [{ tool: 'npm', ecosystem: 'npm', projectDir, command: label }];
  }

  const pip = PIP_MANIFEST_RE.exec(command);
  if (pip) return pipLikeInstalls('pip', pip[1] ?? '', dir, homeDir, label);

  const uv = UV_MANIFEST_RE.exec(command);
  if (uv) {
    const sub = uv[1].replace(/\s+/g, ' ');
    const argsText = uv[2] ?? '';
    if (sub === 'pip install') return pipLikeInstalls('uv', argsText, dir, homeDir, label);
    if (sub === 'pip sync') return pipLikeInstalls('uv', argsText, dir, homeDir, label, true);
    const override = optionValues(tokenize(argsText), ['--directory', '--project'])[0];
    const projectDir = override !== undefined ? resolveDirArg(dir, override, homeDir) : dir;
    return [{ tool: 'uv', ecosystem: 'pypi', projectDir, command: label }];
  }

  const poetry = POETRY_MANIFEST_RE.exec(command);
  if (poetry) {
    const override = optionValues(tokenize(poetry[1] ?? ''), [
      '-C',
      '--directory',
      '-P',
      '--project',
    ])[0];
    const projectDir = override !== undefined ? resolveDirArg(dir, override, homeDir) : dir;
    return [{ tool: 'poetry', ecosystem: 'pypi', projectDir, command: label }];
  }

  if (PIPENV_MANIFEST_RE.test(command)) {
    return [{ tool: 'pipenv', ecosystem: 'pypi', projectDir: dir, command: label }];
  }

  const mvn = MVN_MANIFEST_RE.exec(command);
  if (mvn) {
    const tokens = tokenize(mvn[1]);
    const goals = positionalArgs(tokens, MVN_VALUE_FLAGS);
    // `dependency:get` is a named install (handled by the line matcher); a bare `mvn -v` or
    // `mvn clean` resolves nothing.
    if (goals.length === 0 || goals.some((g) => g.startsWith('dependency:get'))) return [];
    if (goals.every(isNonResolvingGoal)) return [];
    const fileArg = optionValues(tokens, ['-f', '--file'])[0];
    const file = fileArg !== undefined ? resolveDirArg(dir, fileArg, homeDir) : undefined;
    return [
      {
        tool: 'mvn',
        ecosystem: 'maven',
        projectDir: fileArg !== undefined ? undefined : dir,
        files: file ? [file] : fileArg !== undefined ? [] : undefined,
        command: label,
      },
    ];
  }

  return [];
}

/**
 * Classifies install-command shell text: the packages it **names** (FR-1.4: npm/pip/uv/poetry
 * install|add, `mvn dependency:get -Dartifact=…`, pasted Maven `<dependency>` blocks) and the
 * **manifest-driven installs** it runs (`npm ci`, `pip install -r f`, `uv sync`, `mvn test`, …),
 * each with the directory it runs in. A line that matches no known invocation is ignored rather
 * than erroring, consistent with failing open on unparseable input.
 */
export function classifyInstallCommand(
  text: string,
  options: ClassifyInstallOptions = {},
): InstallCommandClassification {
  const source = options.source ?? 'install-command';
  const named: ExtractedDependency[] = [];
  const manifestInstalls: ManifestInstall[] = [];
  let dir: string | undefined = options.cwd;
  // The directory to go back to when each open subshell ends: a `cd` inside `( … )` doesn't
  // outlive it, so `(cd docs) && npm ci` installs from the original directory.
  const subshellDirs: (string | undefined)[] = [];

  // A heredoc body is data (a file being written, a script fed to an interpreter) unless it feeds
  // a shell, in which case it really runs. Track where one starts and ends.
  let heredoc: { terminator: string; runsAsShell: boolean } | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    if (heredoc) {
      if (rawLine.trim() === heredoc.terminator) {
        heredoc = undefined;
        continue;
      }
      if (!heredoc.runsAsShell) continue;
    }

    const line = rawLine.trim();
    if (!line) continue;

    // `cat > f <<'EOF'` opens a body; `<<<` is a here-string, not a heredoc.
    const opener = HEREDOC_OPENER.exec(line);
    if (opener && !heredoc) {
      const before = stripCommandPrefixes(line.slice(0, opener.index).trim());
      heredoc = { terminator: opener[2], runsAsShell: SHELL_INTERPRETER.test(before) };
    }

    for (const segment of splitCommandSegments(line)) {
      if (segment === SUBSHELL_OPEN) {
        subshellDirs.push(dir);
        continue;
      }
      if (segment === SUBSHELL_CLOSE) {
        // An unmatched `)` (a `case` pattern, say) leaves the directory alone.
        if (subshellDirs.length > 0) dir = subshellDirs.pop();
        continue;
      }
      const command = normalizeInvocation(stripCommandPrefixes(segment));

      const moved = applyCd(dir, command, options.homeDir);
      if (moved !== 'unchanged') {
        dir = moved;
        continue;
      }

      for (const { re, handler } of LINE_MATCHERS) {
        const match = re.exec(command);
        if (match) {
          named.push(...handler(match[1], source));
          break;
        }
      }
      manifestInstalls.push(...detectManifestInstalls(command, dir, options.homeDir));
    }
  }

  // Pasted `<dependency>` blocks are a *document* concern (FR-1.4/1.5). When the text is a live
  // shell command (an agent hook, the install wrapper) such a block is almost always file content
  // being written — a heredoc creating a pom.xml fixture — not an install, and treating it as one
  // blocks legitimate work. Those callers pass `includeXmlBlocks: false`.
  if (options.includeXmlBlocks ?? true) {
    named.push(...extractXmlDependencyBlocks(text, source));
  }

  return { named, manifestInstalls };
}

/**
 * Extracts the packages an install command **names** (FR-1.4). A thin view over
 * {@link classifyInstallCommand}; kept as it was because it is part of core's public API.
 */
export function extractInstallCommandDeps(
  text: string,
  source = 'install-command',
  options: { includeXmlBlocks?: boolean } = {},
): ExtractedDependency[] {
  return classifyInstallCommand(text, { source, includeXmlBlocks: options.includeXmlBlocks }).named;
}
