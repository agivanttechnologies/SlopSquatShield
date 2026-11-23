// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildBashZshSnippet,
  buildPowerShellSnippet,
  installSnippetToFile,
  isSnippetInstalledInFile,
  snippetState,
} from '../../src/shell/snippet.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ssg-snippet-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const LEGACY_BASH =
  '# >>> slopsquatshield shell wrapper >>>\nnpm() { slopsquatshield npm "$@"; }\n# <<< slopsquatshield shell wrapper <<<\n';

describe('buildBashZshSnippet / buildPowerShellSnippet', () => {
  it('defines npm/pip/mvn functions that call the launcher by its fixed $HOME path', () => {
    const launcher = '"$HOME/.config/slopsquatshield/bin/slopsquatshield"';
    const bashZsh = buildBashZshSnippet();
    expect(bashZsh).toContain(`npm() { ${launcher} npm "$@"; }`);
    expect(bashZsh).toContain(`pip() { ${launcher} pip "$@"; }`);
    expect(bashZsh).toContain(`mvn() { ${launcher} mvn "$@"; }`);
  });

  it('never calls a bare PATH-dependent slopsquatshield', () => {
    for (const snippet of [buildBashZshSnippet(), buildPowerShellSnippet('win32')]) {
      expect(snippet).not.toMatch(/\{ slopsquatshield /);
    }
  });

  it('PowerShell uses the .ps1 launcher on Windows and the sh launcher elsewhere', () => {
    expect(buildPowerShellSnippet('win32')).toContain(
      'function npm { & "$HOME\\.config\\slopsquatshield\\bin\\slopsquatshield.ps1" npm @args }',
    );
    expect(buildPowerShellSnippet('linux')).toContain(
      'function npm { & "$HOME/.config/slopsquatshield/bin/slopsquatshield" npm @args }',
    );
  });
});

describe('installSnippetToFile / isSnippetInstalledInFile / snippetState', () => {
  it('creates the file (and parent dir) when absent, and reports it as current after', () => {
    const path = join(tmpDir, 'nested', '.bashrc');

    expect(isSnippetInstalledInFile(path)).toBe(false);
    expect(snippetState(path, buildBashZshSnippet())).toBe('absent');
    const result = installSnippetToFile(path, buildBashZshSnippet());
    expect(result).toBe('installed');
    expect(isSnippetInstalledInFile(path)).toBe(true);
    expect(snippetState(path, buildBashZshSnippet())).toBe('current');
  });

  it('is idempotent — a second install is a no-op, never duplicating the snippet', () => {
    const path = join(tmpDir, '.bashrc');

    installSnippetToFile(path, buildBashZshSnippet());
    const second = installSnippetToFile(path, buildBashZshSnippet());

    expect(second).toBe('already-installed');
    expect(readFileSync(path, 'utf-8').match(/npm\(\) \{/g)).toHaveLength(1);
  });

  it('preserves existing file content, appending rather than overwriting', () => {
    const path = join(tmpDir, '.bashrc');
    writeFileSync(path, 'export MY_VAR=hello\n');

    installSnippetToFile(path, buildBashZshSnippet());

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('export MY_VAR=hello');
    expect(content).toContain('npm() {');
  });

  it('upgrades a legacy bare-name block in place, keeping the rest of the file', () => {
    const path = join(tmpDir, '.bashrc');
    writeFileSync(path, `export BEFORE=1\n${LEGACY_BASH}export AFTER=2\n`);

    expect(snippetState(path, buildBashZshSnippet())).toBe('outdated');
    expect(installSnippetToFile(path, buildBashZshSnippet())).toBe('upgraded');

    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('export BEFORE=1');
    expect(content).toContain('export AFTER=2');
    expect(content).not.toMatch(/\{ slopsquatshield npm/);
    expect(content.match(/slopsquatshield shell wrapper >>>/g)).toHaveLength(1);
    expect(snippetState(path, buildBashZshSnippet())).toBe('current');
  });
});
