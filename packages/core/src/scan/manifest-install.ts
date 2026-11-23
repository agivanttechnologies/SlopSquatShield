// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { ManifestInstall } from '../extractors/install-command.js';
import { extractMavenDeps } from '../extractors/maven.js';
import { extractRequirementsTxtDeps } from '../extractors/python/requirements.js';
import type { ExtractedDependency } from '../extractors/types.js';
import { assertWellFormedPom, extractDependenciesFromManifest } from './extract-manifest.js';
import { excludeLocalPackages, packageJsonName } from './local-packages.js';
import { ManifestParseError } from './manifest-error.js';

/**
 * File access for {@link collectManifestInstall}. Core never touches the filesystem itself — the
 * CLI supplies a Node implementation, tests supply an in-memory one — the same split as
 * `loadProjectContext`: reading files belongs to the adapter, deciding what they mean to core.
 */
export interface ManifestReader {
  /** The file's text, or `undefined` if it is missing or unreadable. */
  readFile(absPath: string): string | undefined;
  /** Names of the child directories of `absPath`, or `undefined` if it cannot be listed. */
  listDirs(absPath: string): string[] | undefined;
  exists(absPath: string): boolean;
}

export interface CollectLimits {
  /** Stop reading after this many files (default 100). */
  maxFiles?: number;
  /** Skip any single file larger than this (default 5 MB). */
  maxFileBytes?: number;
  /** The upward search for a manifest stops here (like npm's own lookup). */
  homeDir?: string;
}

export interface CollectedManifests {
  /** Every dependency the install will fetch, with the manifest that declares it. */
  entries: Array<{ dep: ExtractedDependency; file: string }>;
  /** Absolute paths of the manifests that were read. */
  files: string[];
  /** Manifests that could not be parsed — reported, never a stack trace. */
  errors: ManifestParseError[];
  /** Plain-English coverage caveats: something the install reads that was not checked, and why. */
  notes: string[];
  /** Lockfiles next to the manifest. Located only; parsed lazily by the caller if needed. */
  lockfiles: string[];
}

const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUIREMENTS_DEPTH = 5;
const MAX_MODULE_DEPTH = 3;

const xml = new XMLParser({ ignoreAttributes: true });

/**
 * Works out which dependencies a manifest-driven install will fetch, by reading **exactly what the
 * package manager itself reads** — never by walking a directory tree. A recursive walk from a home
 * directory or a large monorepo would be slow and would check unrelated projects, producing false
 * denials. So: npm reads the nearest package.json (searching upward, stopping at the home
 * directory) plus the workspaces it declares; `pip install -r` reads the named files and any `-r`
 * they include; poetry/uv read pyproject.toml; pipenv reads Pipfile; Maven reads the POM and its
 * declared modules, statically — it never runs `mvn`.
 */
export function collectManifestInstall(
  install: ManifestInstall,
  io: ManifestReader,
  limits: CollectLimits = {},
): CollectedManifests {
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const out: CollectedManifests = { entries: [], files: [], errors: [], notes: [], lockfiles: [] };

  /** Reads a file within the caps; `undefined` (with a note where useful) when it can't be used. */
  const read = (path: string): string | undefined => {
    if (out.files.length >= maxFiles) {
      noteOnce(`stopped after ${maxFiles} manifests; the rest were not checked`);
      return undefined;
    }
    const text = io.readFile(path);
    if (text === undefined) return undefined;
    if (text.length > maxBytes) {
      out.notes.push(
        `${path} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB and was not checked`,
      );
      return undefined;
    }
    out.files.push(path);
    return text;
  };
  const noteOnce = (note: string) => {
    if (!out.notes.includes(note)) out.notes.push(note);
  };
  const guarded = (path: string, work: () => void): void => {
    try {
      work();
    } catch (err) {
      if (err instanceof ManifestParseError) out.errors.push(err);
      else
        out.errors.push(new ManifestParseError(path, 1, 1, `could not read file: ${String(err)}`));
    }
  };
  const addAll = (file: string, deps: ExtractedDependency[]) => {
    for (const dep of deps) out.entries.push({ dep, file });
  };
  const addLockfiles = (dir: string, names: readonly string[]) => {
    for (const name of names) if (io.exists(join(dir, name))) out.lockfiles.push(join(dir, name));
  };
  /** The nearest directory at or above `start` containing `fileName`. */
  const ascend = (start: string, fileName: string): string | undefined => {
    let dir = start;
    for (;;) {
      if (io.exists(join(dir, fileName))) return dir;
      const parent = dirname(dir);
      if (parent === dir || dir === limits.homeDir) return undefined;
      dir = parent;
    }
  };

  switch (install.tool) {
    case 'npm':
      collectNpm();
      break;
    case 'pip':
    case 'uv':
      if (install.files !== undefined) collectRequirements(install.files);
      else collectProjectFile('pyproject.toml', false, ['poetry.lock', 'Pipfile.lock']);
      break;
    case 'poetry':
      collectProjectFile('pyproject.toml', true, ['poetry.lock']);
      break;
    case 'pipenv':
      collectProjectFile('Pipfile', true, ['Pipfile.lock']);
      break;
    case 'mvn':
      collectMaven();
      break;
  }
  return out;

  // ---- npm -----------------------------------------------------------------------------------
  function collectNpm(): void {
    if (!install.projectDir) return;
    const root = ascend(install.projectDir, 'package.json');
    if (!root) return; // nothing to install from — npm will say so itself

    const localNames = new Set<string>();
    const readPackage = (dir: string): void => {
      const path = join(dir, 'package.json');
      const text = read(path);
      if (text === undefined) return;
      guarded(path, () => addAll(path, extractDependenciesFromManifest(path, text)));
      const name = packageJsonName(text);
      if (name) localNames.add(name);
    };

    readPackage(root);
    for (const member of workspaceDirs(root)) readPackage(member);

    out.entries = out.entries.filter(
      ({ dep }) => excludeLocalPackages([dep], localNames).length === 1,
    );
    addLockfiles(root, ['package-lock.json', 'npm-shrinkwrap.json']);
  }

  function workspaceDirs(root: string): string[] {
    const text = io.readFile(join(root, 'package.json'));
    if (text === undefined) return [];
    let patterns: unknown;
    try {
      const parsed = JSON.parse(text) as { workspaces?: unknown };
      const ws = parsed.workspaces;
      patterns = Array.isArray(ws) ? ws : (ws as { packages?: unknown } | undefined)?.packages;
    } catch {
      return [];
    }
    if (!Array.isArray(patterns)) return [];

    const included = new Set<string>();
    const excluded = new Set<string>();
    for (const raw of patterns) {
      if (typeof raw !== 'string') continue;
      const negated = raw.startsWith('!');
      const pattern = (negated ? raw.slice(1) : raw).replace(/^\.\//, '').replace(/\/+$/, '');
      if (!pattern) continue;
      const matches = expandWorkspacePattern(root, pattern);
      if (matches === undefined) {
        noteOnce(
          `the workspace pattern "${raw}" matched too many directories to search, so some packages were not checked`,
        );
        continue;
      }
      for (const dir of matches) (negated ? excluded : included).add(dir);
    }
    return [...included].filter((dir) => !excluded.has(dir));
  }

  /**
   * The directories a workspace glob names, the way npm's own expansion sees them: `*`, `?`,
   * `[abc]` and `{a,b}` within a path segment, and `**` for any depth (including none). A literal
   * path is returned as is; a glob match counts only when it holds a `package.json`. `**` never
   * descends into `node_modules` or dot-directories. `undefined` when the walk hits its size limit.
   */
  function expandWorkspacePattern(root: string, pattern: string): string[] | undefined {
    const segments = pattern.split('/').filter((seg) => seg !== '' && seg !== '.');
    if (!segments.some(isGlobSegment)) return [join(root, ...segments)];

    const found = new Set<string>();
    let visited = 0;
    let overflow = false;
    const walk = (dir: string, i: number, depth: number): void => {
      if (overflow) return;
      if (++visited > MAX_WORKSPACE_DIRS_VISITED || depth > MAX_WORKSPACE_DEPTH) {
        overflow = true;
        return;
      }
      if (i === segments.length) {
        if (io.exists(join(dir, 'package.json'))) found.add(dir);
        return;
      }
      const seg = segments[i] as string;
      if (seg === '**') {
        walk(dir, i + 1, depth); // zero directories
        for (const child of io.listDirs(dir) ?? []) {
          if (child.startsWith('.') || child === 'node_modules') continue;
          walk(join(dir, child), i, depth + 1);
        }
        return;
      }
      if (!isGlobSegment(seg)) {
        walk(join(dir, seg), i + 1, depth + 1);
        return;
      }
      const re = segmentRegExp(seg);
      for (const child of io.listDirs(dir) ?? []) {
        if (child === 'node_modules' || (child.startsWith('.') && !seg.startsWith('.'))) continue;
        if (re.test(child)) walk(join(dir, child), i + 1, depth + 1);
      }
    };
    walk(root, 0, 0);
    return overflow ? undefined : [...found];
  }

  // ---- pip / uv requirements files --------------------------------------------------------------
  function collectRequirements(files: string[]): void {
    if (files.length === 0) {
      noteOnce(`could not tell which requirements file \`${install.command}\` reads`);
      return;
    }
    const visited = new Set<string>();
    const visit = (file: string, depth: number): void => {
      const path = resolve(file);
      if (visited.has(path)) return;
      visited.add(path);
      const text = read(path);
      if (text === undefined) return;
      guarded(path, () => addAll(path, extractRequirementsTxtDeps(text, path)));
      if (depth >= MAX_REQUIREMENTS_DEPTH) {
        noteOnce(
          `requirements files are nested more than ${MAX_REQUIREMENTS_DEPTH} deep; the rest were not checked`,
        );
        return;
      }
      for (const line of text.split(/\r?\n/)) {
        const include = /^\s*(?:-r|--requirement)(?:\s+|=)(\S+)/.exec(line);
        if (include)
          visit(isAbsolute(include[1]) ? include[1] : join(dirname(path), include[1]), depth + 1);
      }
    };
    for (const file of files) visit(file, 0);
  }

  // ---- pyproject.toml / Pipfile ---------------------------------------------------------------
  function collectProjectFile(fileName: string, searchUpward: boolean, lockNames: string[]): void {
    if (!install.projectDir) return;
    const dir = searchUpward
      ? ascend(install.projectDir, fileName)
      : io.exists(join(install.projectDir, fileName))
        ? install.projectDir
        : undefined;
    if (!dir) {
      if (fileName === 'pyproject.toml' && !searchUpward) {
        noteOnce(`no pyproject.toml in ${install.projectDir}; a setup.py project is not checked`);
      }
      return;
    }
    const path = join(dir, fileName);
    const text = read(path);
    if (text === undefined) return;
    guarded(path, () => addAll(path, extractDependenciesFromManifest(path, text)));
    addLockfiles(dir, lockNames);
  }

  // ---- Maven ---------------------------------------------------------------------------------
  function collectMaven(): void {
    const given = install.files?.[0];
    const rootPom = given
      ? given.endsWith('.xml')
        ? given
        : join(given, 'pom.xml')
      : install.projectDir
        ? join(install.projectDir, 'pom.xml')
        : undefined;
    if (!rootPom) {
      noteOnce(`could not tell which POM \`${install.command}\` reads`);
      return;
    }

    const poms: Array<{ path: string; content: string }> = [];
    const visit = (pomPath: string, depth: number): void => {
      const content = read(pomPath);
      if (content === undefined) return;
      let wellFormed = true;
      guarded(pomPath, () => assertWellFormedPom(pomPath, content));
      if (out.errors.some((e) => e.file === pomPath)) wellFormed = false;
      if (!wellFormed) return;
      poms.push({ path: pomPath, content });
      if (depth >= MAX_MODULE_DEPTH) return;
      for (const module of moduleNames(content)) {
        const target = join(dirname(pomPath), module);
        visit(module.endsWith('.xml') ? target : join(target, 'pom.xml'), depth + 1);
      }
    };
    visit(rootPom, 0);

    if (poms.length > 0) {
      guarded(rootPom, () => {
        const deps = extractMavenDeps(poms);
        // Each dependency's declaring POM is not tracked by the extractor; attribute to the root.
        addAll(rootPom, deps);
      });
    }
  }
}

function moduleNames(pomText: string): string[] {
  try {
    const modules = (xml.parse(pomText) as { project?: { modules?: { module?: unknown } } }).project
      ?.modules?.module;
    if (typeof modules === 'string') return [modules];
    return Array.isArray(modules) ? modules.filter((m): m is string => typeof m === 'string') : [];
  } catch {
    return [];
  }
}

/** A path for messages: relative to `cwd` when it is inside it, else as given. */
export function displayPath(path: string, cwd: string | undefined): string {
  if (!cwd) return path;
  const rel = relative(cwd, path);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

/** Bounds on expanding one workspace glob, so a `**` in a huge tree can't stall a hook. */
const MAX_WORKSPACE_DIRS_VISITED = 5000;
const MAX_WORKSPACE_DEPTH = 12;

function isGlobSegment(segment: string): boolean {
  return /[*?[{]/.test(segment);
}

/** One path segment of a glob (`pkg-*`, `{a,b}`, `v[0-9]`) as an anchored regular expression. */
function segmentRegExp(segment: string): RegExp {
  let re = '';
  let braceDepth = 0;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i] as string;
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const close = segment.indexOf(']', i + 1);
      if (close === -1) re += '\\[';
      else {
        const body = segment
          .slice(i + 1, close)
          .replace(/^!/, '^')
          .replace(/\\/g, '\\\\');
        re += `[${body}]`;
        i = close;
      }
    } else if (c === '{') {
      braceDepth++;
      re += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      re += ')';
    } else if (c === ',' && braceDepth > 0) re += '|';
    else re += c.replace(/[.+^$()|\\\]]/g, '\\$&');
  }
  while (braceDepth-- > 0) re += ')';
  return new RegExp(`^${re}$`);
}
