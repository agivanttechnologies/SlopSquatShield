// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { CREDIT } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import type { InitResult } from '../../src/commands/init.js';
import { formatInitResult as format } from '../../src/format/init.js';
import { plainStyle } from '../../src/format/style.js';

// Piped style unless a test says otherwise: no colour, no credit.
const formatInitResult = (r: InitResult, style = plainStyle()) => format(r, { style });

const base: InitResult = { detectedEcosystems: [], allowlist: 'created' };

describe('formatInitResult', () => {
  it('ends with the credit on a terminal, and leaves it out when piped', () => {
    expect(
      formatInitResult(base, plainStyle({ tty: true }))
        .text.split('\n')
        .at(-1),
    ).toBe(CREDIT);
    expect(formatInitResult(base).text).not.toContain(CREDIT);
  });

  it('only gives next steps for what was set up: no "new terminal" without a shell wrapper', () => {
    const { text } = formatInitResult({ ...base, claudeCodeHook: 'installed' });
    expect(text).toContain(
      'Next: restart your AI agent so it picks up the hook, then run `slopsquatshield doctor` to check.',
    );
    expect(text).not.toContain('new terminal');
  });

  it('a shell-only init says to open a new terminal, not to restart an agent', () => {
    const { text } = formatInitResult({
      ...base,
      shell: { bash: 'installed', zsh: 'installed', powershell: [] },
    });
    expect(text).toContain('Next: open a new terminal so the shell wrapper loads, then run');
    expect(text).not.toContain('restart your AI agent');
  });

  it('says what was set up, in words, and what to do next', () => {
    const { text, ok } = formatInitResult({
      ...base,
      detectedEcosystems: ['npm', 'pypi'],
      launcher: { status: 'written', path: '/home/u/.config/slopsquatshield/bin/slopsquatshield' },
      shell: {
        bash: 'upgraded',
        zsh: 'installed',
        powershell: [{ label: 'PowerShell', path: '/p', result: 'already-installed' }],
      },
      claudeCodeHook: 'installed',
    });

    expect(ok).toBe(true);
    expect(text).toContain('Set up:');
    expect(text).toContain('/home/u/.config/slopsquatshield/bin/slopsquatshield');
    expect(text).toContain('bash upgraded in place; zsh installed; PowerShell already set up');
    expect(text).toContain('Claude Code');
    expect(text).toContain('found npm, pypi manifests here');
    expect(text).toContain('Next: open a new terminal');
    expect(text).not.toContain('{');
  });

  it('names each PowerShell edition when there are two profiles', () => {
    const { text } = formatInitResult({
      ...base,
      launcher: { status: 'written', path: '/l' },
      shell: {
        bash: 'installed',
        zsh: 'installed',
        powershell: [
          { label: 'PowerShell 7', path: '/a', result: 'already-installed' },
          { label: 'Windows PowerShell 5.1', path: '/b', result: 'installed' },
        ],
      },
    });
    expect(text).toContain('PowerShell 7 already set up; Windows PowerShell 5.1 installed');
  });

  it('is not ok, and says why, when an existing git hook is in another language', () => {
    const { text, ok } = formatInitResult({
      ...base,
      launcher: { status: 'written', path: '/l' },
      gitHook: { result: 'unsupported-existing-hook', path: '/repo/.git/hooks/pre-commit' },
    });

    expect(ok).toBe(false);
    expect(text).toContain('Not set up:');
    expect(text).toContain('is not a shell script, so it was left untouched');
    expect(text).toContain('/repo/.git/hooks/pre-commit');
  });

  it('is not ok outside a git repository', () => {
    const { text, ok } = formatInitResult({ ...base, gitHook: { result: 'not-a-repo' } });
    expect(ok).toBe(false);
    expect(text).toContain('not inside a git repository');
  });

  it('is not ok when a host config is not valid JSON, and says it was left untouched', () => {
    const { text, ok } = formatInitResult({
      ...base,
      launcher: { status: 'written', path: '/l' },
      cursorHook: 'invalid-json',
    });
    expect(ok).toBe(false);
    expect(text).toContain('Cursor');
    expect(text).toContain('not valid JSON');
    expect(text).toContain('left untouched');
  });

  it('is not ok when run from an npx cache, and gives the reason', () => {
    const { text, ok } = formatInitResult({
      ...base,
      launcher: { status: 'refused-ephemeral', message: 'running from a temporary npx cache' },
    });
    expect(ok).toBe(false);
    expect(text).toContain('running from a temporary npx cache');
    expect(text).not.toContain('Next:');
  });

  it('a bare `init` is fine and does not nag about next steps it has not earned', () => {
    const { text, ok } = formatInitResult(base);
    expect(ok).toBe(true);
    expect(text).toContain('created .slopsquatshield');
    expect(text).not.toContain('Next:');
  });

  it('says so when --all found no agent host', () => {
    const { text } = formatInitResult({ ...base, detectedHosts: [] });
    expect(text).toContain('no agent host found');
  });
});
