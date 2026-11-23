// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../fixtures/maven/lockfile/${name}`, import.meta.url)),
    'utf-8',
  );
}

describe('parseMavenDependencyTree', () => {
  it('extracts every dependency coordinate, excluding the root project line', async () => {
    const { parseMavenDependencyTree } = await import('../../../src/resolvers/lockfile/maven.js');
    const pins = parseMavenDependencyTree(readFixture('dependency-tree.txt'));

    expect(pins).toEqual([
      { name: 'org.apache.commons:commons-lang3', version: '3.14.0' },
      { name: 'com.fasterxml.jackson.core:jackson-databind', version: '2.17.0' },
      { name: 'com.fasterxml.jackson.core:jackson-core', version: '2.17.0' },
      { name: 'junit:junit', version: '4.13.2' },
    ]);
  });

  it('leaves out a coordinate whose POM Maven reports missing, though it is still in the tree', async () => {
    // Real Maven 3.9.9 output: a nonexistent dependency is listed and the build "succeeds".
    const { parseMavenDependencyTree } = await import('../../../src/resolvers/lockfile/maven.js');
    const pins = parseMavenDependencyTree(readFixture('dependency-tree-missing-pom.txt'));

    expect(pins).toEqual([{ name: 'org.apache.commons:commons-lang3', version: '3.14.0' }]);
  });
});

describe('getMavenDependencyTreePins', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.doUnmock('../../../src/exec/find-on-path.js');
    vi.resetModules();
  });

  const mockMvnOnPath = (path: string | undefined) =>
    vi.doMock('../../../src/exec/find-on-path.js', () => ({ findOnPath: () => path }));

  it('parses the stdout of a successful `mvn dependency:tree` run', async () => {
    vi.resetModules();
    mockMvnOnPath('/usr/bin/mvn');
    const calls: string[] = [];
    vi.doMock('node:child_process', () => ({
      execFile: (
        cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: unknown, result: { stdout: string; stderr: string }) => void,
      ) => {
        calls.push(cmd);
        cb(null, { stdout: readFixture('dependency-tree.txt'), stderr: '' });
      },
    }));

    const { getMavenDependencyTreePins } = await import('../../../src/resolvers/lockfile/maven.js');
    const pins = await getMavenDependencyTreePins('/some/project');

    expect(pins).toContainEqual({ name: 'org.apache.commons:commons-lang3', version: '3.14.0' });
    // The PATH-resolved binary, never a bare `mvn` the project directory could supply.
    expect(calls).toEqual(['/usr/bin/mvn']);
  });

  it('runs nothing when mvn is not on PATH (an mvn.exe in the project must never run)', async () => {
    vi.resetModules();
    mockMvnOnPath(undefined);
    const execFile = vi.fn();
    vi.doMock('node:child_process', () => ({ execFile }));

    const { getMavenDependencyTreePins } = await import('../../../src/resolvers/lockfile/maven.js');
    expect(await getMavenDependencyTreePins('/some/project')).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('fails open to an empty result when Maven fails to run (NFR-3.1)', async () => {
    vi.resetModules();
    mockMvnOnPath('/usr/bin/mvn');
    vi.doMock('node:child_process', () => ({
      execFile: (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: unknown, result?: unknown) => void,
      ) => cb(new Error('spawn mvn ENOENT')),
    }));

    const { getMavenDependencyTreePins } = await import('../../../src/resolvers/lockfile/maven.js');
    const pins = await getMavenDependencyTreePins('/some/project');

    expect(pins).toEqual([]);
  });
});
