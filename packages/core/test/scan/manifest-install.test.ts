// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { ManifestInstall } from '../../src/extractors/install-command.js';
import { collectManifestInstall } from '../../src/scan/manifest-install.js';
import { at, memReader } from '../helpers/mem-reader.js';

const npm = (projectDir: string | undefined = at()): ManifestInstall => ({
  tool: 'npm',
  ecosystem: 'npm',
  projectDir,
  command: 'npm install',
});
const names = (r: ReturnType<typeof collectManifestInstall>) =>
  r.entries.map((e) => e.dep.name).sort();

describe('collectManifestInstall: npm', () => {
  it('reads the project package.json: every dependency field, attributed to its file', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({
        name: 'app',
        dependencies: { express: '^4' },
        devDependencies: { vitest: '^2' },
        optionalDependencies: { fsevents: '*' },
      }),
    });

    const out = collectManifestInstall(npm(), io);

    expect(names(out)).toEqual(['express', 'fsevents', 'vitest']);
    expect(out.entries.every((e) => e.file === at('package.json'))).toBe(true);
    expect(out.files).toEqual([at('package.json')]);
  });

  it('searches upward for the nearest package.json, as npm does', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({ dependencies: { express: '1' } }),
    });
    expect(names(collectManifestInstall(npm(at('src', 'deep')), io))).toEqual(['express']);
  });

  it('stops the upward search at the home directory', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({ dependencies: { express: '1' } }),
    });
    const out = collectManifestInstall(npm(at('home', 'me')), io, { homeDir: at('home', 'me') });
    expect(out.entries).toEqual([]);
    expect(io.reads).toEqual([]);
  });

  it('finds nothing, quietly, when there is no package.json (npm will say so itself)', () => {
    const out = collectManifestInstall(npm(), memReader({}));
    expect(out).toEqual({ entries: [], files: [], errors: [], notes: [], lockfiles: [] });
  });

  it('reports an unparseable package.json instead of throwing', () => {
    const out = collectManifestInstall(npm(), memReader({ [at('package.json')]: '{ broken' }));
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]?.file).toBe(at('package.json'));
    expect(out.entries).toEqual([]);
  });

  it('expands literal and "dir/*" workspaces, and drops the project’s own members', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({
        name: 'root',
        workspaces: ['packages/*', 'tools/cli'],
      }),
      [at('packages', 'a', 'package.json')]: JSON.stringify({
        name: '@m/a',
        dependencies: { '@m/b': '*', 'left-pad': '^1' },
      }),
      [at('packages', 'b', 'package.json')]: JSON.stringify({ name: '@m/b' }),
      [at('tools', 'cli', 'package.json')]: JSON.stringify({
        name: 'cli',
        dependencies: { chalk: '5' },
      }),
    });

    const out = collectManifestInstall(npm(), io);

    expect(names(out)).toEqual(['chalk', 'left-pad']);
    expect(out.entries.find((e) => e.dep.name === 'left-pad')?.file).toBe(
      at('packages', 'a', 'package.json'),
    );
  });

  it('accepts the { packages: [...] } workspaces form', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({ workspaces: { packages: ['libs/*'] } }),
      [at('libs', 'x', 'package.json')]: JSON.stringify({ dependencies: { chalk: '5' } }),
    });
    expect(names(collectManifestInstall(npm(), io))).toEqual(['chalk']);
  });

  it('drops file:/link:/workspace: dependencies, which are not on the registry', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({
        dependencies: { local: 'file:../local', linked: 'link:../l', real: '^1' },
      }),
    });
    expect(names(collectManifestInstall(npm(), io))).toEqual(['real']);
  });

  it('expands "**", brace and character-class workspace globs (they used to be skipped)', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({
        workspaces: ['packages/**', '{apps,tools}/*', 'libs/v[0-9]'],
      }),
      [at('packages', 'package.json')]: JSON.stringify({ dependencies: { 'dep-top': '1' } }),
      [at('packages', 'a', 'package.json')]: JSON.stringify({ dependencies: { 'dep-a': '1' } }),
      [at('packages', 'group', 'deep', 'package.json')]: JSON.stringify({
        dependencies: { 'dep-deep': '1' },
      }),
      [at('packages', 'group', 'README.md')]: 'no package here',
      [at('packages', 'a', 'node_modules', 'x', 'package.json')]: JSON.stringify({
        dependencies: { 'dep-in-node-modules': '1' },
      }),
      [at('packages', '.hidden', 'package.json')]: JSON.stringify({
        dependencies: { 'dep-hidden': '1' },
      }),
      [at('apps', 'web', 'package.json')]: JSON.stringify({ dependencies: { 'dep-web': '1' } }),
      [at('tools', 'cli', 'package.json')]: JSON.stringify({ dependencies: { 'dep-cli': '1' } }),
      [at('other', 'z', 'package.json')]: JSON.stringify({ dependencies: { 'dep-other': '1' } }),
      [at('libs', 'v2', 'package.json')]: JSON.stringify({ dependencies: { 'dep-v2': '1' } }),
      [at('libs', 'vx', 'package.json')]: JSON.stringify({ dependencies: { 'dep-vx': '1' } }),
    });

    const out = collectManifestInstall(npm(), io);

    expect(names(out)).toEqual(['dep-a', 'dep-cli', 'dep-deep', 'dep-top', 'dep-v2', 'dep-web']);
    expect(out.notes).toEqual([]);
  });

  it('honours "!" exclusions in workspace patterns', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({ workspaces: ['packages/*', '!packages/old'] }),
      [at('packages', 'new', 'package.json')]: JSON.stringify({ dependencies: { fresh: '1' } }),
      [at('packages', 'old', 'package.json')]: JSON.stringify({ dependencies: { stale: '1' } }),
    });
    expect(names(collectManifestInstall(npm(), io))).toEqual(['fresh']);
  });

  it('locates, but does not read, the lockfile', () => {
    const io = memReader({
      [at('package.json')]: JSON.stringify({ dependencies: { a: '1' } }),
      [at('package-lock.json')]: '{"huge":"file"}',
    });
    const out = collectManifestInstall(npm(), io);
    expect(out.lockfiles).toEqual([at('package-lock.json')]);
    expect(io.reads).not.toContain(at('package-lock.json'));
  });

  it('stops at the file cap and says what was left unchecked', () => {
    const files: Record<string, string> = {
      [at('package.json')]: JSON.stringify({ workspaces: ['p/*'] }),
    };
    for (const n of ['a', 'b', 'c', 'd']) {
      files[at('p', n, 'package.json')] = JSON.stringify({ dependencies: { [`dep-${n}`]: '1' } });
    }
    const out = collectManifestInstall(npm(), memReader(files), { maxFiles: 3 });
    expect(out.files).toHaveLength(3);
    expect(out.notes.join(' ')).toContain('stopped after 3 manifests');
  });

  it('skips an oversized file with a note', () => {
    const io = memReader({ [at('package.json')]: JSON.stringify({ dependencies: { a: '1' } }) });
    const out = collectManifestInstall(npm(), io, { maxFileBytes: 5 });
    expect(out.entries).toEqual([]);
    expect(out.notes.join(' ')).toContain('was not checked');
  });
});

describe('collectManifestInstall: python', () => {
  const pip = (
    files: string[] | undefined,
    projectDir: string | undefined = at(),
  ): ManifestInstall => ({
    tool: 'pip',
    ecosystem: 'pypi',
    projectDir,
    files,
    command: 'pip install -r f',
  });

  it('reads exactly the requirements files named, and follows -r includes (cycle-safe)', () => {
    const io = memReader({
      [at('req.txt')]: 'requests\n-r base.txt\n',
      [at('base.txt')]: 'flask\n--requirement req.txt\n',
    });

    const out = collectManifestInstall(pip([at('req.txt')]), io);

    expect(names(out)).toEqual(['flask', 'requests']);
    expect(out.files).toHaveLength(2);
  });

  it('resolves a nested include relative to the file that includes it', () => {
    const io = memReader({
      [at('reqs', 'top.txt')]: '-r shared/base.txt\n',
      [at('reqs', 'shared', 'base.txt')]: 'flask\n',
    });
    expect(names(collectManifestInstall(pip([at('reqs', 'top.txt')]), io))).toEqual(['flask']);
  });

  it('a missing requirements file contributes nothing (pip will fail on its own)', () => {
    expect(collectManifestInstall(pip([at('nope.txt')]), memReader({})).entries).toEqual([]);
  });

  it('says so when the file could not be determined', () => {
    const out = collectManifestInstall(pip([]), memReader({}));
    expect(out.notes.join(' ')).toContain('could not tell which requirements file');
  });

  it('pip install . reads pyproject.toml in that directory', () => {
    const io = memReader({
      [at('pyproject.toml')]: '[project]\nname = "x"\nversion = "1"\ndependencies = ["requests"]\n',
    });
    expect(names(collectManifestInstall(pip(undefined), io))).toEqual(['requests']);
  });

  it('pip install . with no pyproject.toml says a setup.py project is not checked', () => {
    const out = collectManifestInstall(pip(undefined), memReader({}));
    expect(out.notes.join(' ')).toContain('setup.py');
  });

  it('poetry and uv search upward for pyproject.toml; pipenv for Pipfile', () => {
    const io = memReader({
      [at('pyproject.toml')]: '[project]\nname = "x"\nversion = "1"\ndependencies = ["requests"]\n',
      [at('Pipfile')]: '[packages]\nflask = "*"\n',
      [at('poetry.lock')]: '',
    });
    const poetry = collectManifestInstall(
      { tool: 'poetry', ecosystem: 'pypi', projectDir: at('src'), command: 'poetry install' },
      io,
    );
    expect(names(poetry)).toEqual(['requests']);
    expect(poetry.lockfiles).toEqual([at('poetry.lock')]);
    const pipenv = collectManifestInstall(
      { tool: 'pipenv', ecosystem: 'pypi', projectDir: at('src'), command: 'pipenv install' },
      io,
    );
    expect(names(pipenv)).toEqual(['flask']);
  });
});

describe('collectManifestInstall: maven', () => {
  const mvn = (over: Partial<ManifestInstall> = {}): ManifestInstall => ({
    tool: 'mvn',
    ecosystem: 'maven',
    projectDir: at(),
    command: 'mvn test',
    ...over,
  });
  const pom = (deps: string, extra = '') =>
    `<project><modelVersion>4.0.0</modelVersion><groupId>t</groupId><artifactId>a</artifactId><version>1</version>${extra}<dependencies>${deps}</dependencies></project>`;
  const dep = (g: string, a: string) =>
    `<dependency><groupId>${g}</groupId><artifactId>${a}</artifactId><version>1</version></dependency>`;

  it('reads the POM in the project directory, without running mvn', () => {
    const io = memReader({ [at('pom.xml')]: pom(dep('org.x', 'y')) });
    expect(names(collectManifestInstall(mvn(), io))).toEqual(['org.x:y']);
  });

  it('follows declared <modules>, depth-limited', () => {
    const io = memReader({
      [at('pom.xml')]: pom(dep('org.x', 'root'), '<modules><module>child</module></modules>'),
      [at('child', 'pom.xml')]: pom(dep('org.x', 'kid')),
    });
    expect(names(collectManifestInstall(mvn(), io))).toEqual(['org.x:kid', 'org.x:root']);
  });

  it('-f names the POM (a file, or a directory containing one)', () => {
    const io = memReader({ [at('sub', 'pom.xml')]: pom(dep('org.x', 'y')) });
    expect(
      names(
        collectManifestInstall(mvn({ projectDir: undefined, files: [at('sub', 'pom.xml')] }), io),
      ),
    ).toEqual(['org.x:y']);
    expect(
      names(collectManifestInstall(mvn({ projectDir: undefined, files: [at('sub')] }), io)),
    ).toEqual(['org.x:y']);
  });

  it('reports a malformed POM instead of throwing', () => {
    const out = collectManifestInstall(
      mvn(),
      memReader({ [at('pom.xml')]: '<project><dependencies>' }),
    );
    expect(out.errors).toHaveLength(1);
    expect(out.entries).toEqual([]);
  });

  it('finds nothing, quietly, when there is no POM', () => {
    expect(collectManifestInstall(mvn(), memReader({}))).toEqual({
      entries: [],
      files: [],
      errors: [],
      notes: [],
      lockfiles: [],
    });
  });
});
