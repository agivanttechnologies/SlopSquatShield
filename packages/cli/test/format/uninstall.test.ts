// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join, sep } from 'node:path';
import { CREDIT } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import type { UninstallResult } from '../../src/commands/uninstall.js';
import { plainStyle } from '../../src/format/style.js';
import { formatUninstallResult } from '../../src/format/uninstall.js';

// Absolute paths in this OS's own form, so the test holds on Windows too.
const HOME = join(sep, 'home', 'u');
const at = (...parts: string[]) => join(HOME, ...parts);
const opts = { paths: { cwd: join(sep, 'work'), home: HOME }, style: plainStyle() };
const tilde = (...parts: string[]) => `~${sep}${join(...parts)}`;
const result = (over: Partial<UninstallResult>): UninstallResult => ({
  dryRun: false,
  ok: true,
  actions: [],
  ...over,
});

describe('formatUninstallResult', () => {
  it('lists what was removed with paths relative to ~, then the next step', () => {
    const text = formatUninstallResult(
      result({
        actions: [
          {
            surface: 'Shell wrapper (bash)',
            location: at('.bashrc'),
            outcome: 'removed',
          },
        ],
      }),
      opts,
    );

    expect(text).toContain('Removed:');
    expect(text).toContain(tilde('.bashrc'));
    expect(text).not.toContain(HOME);
    expect(text).toContain('npm uninstall -g slopsquatshield');
    expect(text).toContain('.slopsquatshield / .slopsquatshieldrc');
  });

  it('says plainly that a dry run changed nothing', () => {
    const text = formatUninstallResult(
      result({
        dryRun: true,
        actions: [
          {
            surface: 'Launcher and CI shims',
            location: at('.config', 'slopsquatshield'),
            outcome: 'removed',
          },
        ],
      }),
      opts,
    );

    expect(text).toContain('Would remove (dry run — nothing was changed):');
    expect(text).toContain('Run it again without --dry-run');
    expect(text).not.toContain('npm uninstall -g');
  });

  it('flags what it could not remove safely', () => {
    const text = formatUninstallResult(
      result({
        ok: false,
        actions: [
          {
            surface: 'Claude Code hook',
            location: at('.claude', 'settings.json'),
            outcome: 'left-untouched',
            note: 'is not valid JSON, so it was left untouched — remove our entry by hand',
          },
        ],
      }),
      opts,
    );

    expect(text).toContain('Left untouched — needs you:');
    expect(text).toContain(tilde('.claude', 'settings.json'));
    expect(text).toContain('not valid JSON');
  });

  it('ends with the credit on a terminal only', () => {
    const r = result({ actions: [] });
    const tty = formatUninstallResult(r, { ...opts, style: plainStyle({ tty: true }) });
    expect(tty.split('\n').at(-1)).toBe(CREDIT);
    expect(formatUninstallResult(r, opts)).not.toContain(CREDIT);
  });

  it('says so when there is nothing to remove', () => {
    const text = formatUninstallResult(
      result({ actions: [{ surface: 'x', location: at('x'), outcome: 'not-found' }] }),
      opts,
    );
    expect(text).toContain("Nothing to remove: SlopSquatShield isn't set up here.");
    expect(text).not.toContain('Next:');
  });
});
