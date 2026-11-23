// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join, sep } from 'node:path';
import { CREDIT } from '@slopsquatshield/core';
import { describe, expect, it } from 'vitest';
import type { DoctorReport } from '../../src/commands/doctor.js';
import { formatDoctorReport } from '../../src/format/doctor.js';
import { plainStyle } from '../../src/format/style.js';

const home = join(sep, 'home', 'u');
const cwd = join(home, 'proj');
const report: DoctorReport = {
  checks: [
    {
      surface: 'Allowlist',
      status: 'ok',
      detail: `.slopsquatshield found at ${join(cwd, '.slopsquatshield')}`,
    },
    {
      surface: 'Shell wrapper (bash/zsh)',
      status: 'missing',
      detail: `Not installed in ${join(home, '.bashrc')}`,
      fixCommand: 'slopsquatshield init --shell',
    },
    {
      surface: 'Claude Code hook',
      status: 'ok',
      detail: 'Hook configured in ~/.claude/settings.json',
    },
    {
      surface: 'Git pre-commit hook',
      status: 'outdated',
      detail: 'old',
      fixCommand: 'slopsquatshield init --git-hook',
    },
    {
      surface: 'Java/Maven toolchain',
      status: 'missing',
      detail: 'java and/or mvn not found on PATH',
      fixCommand: 'install a JDK and Apache Maven',
    },
  ],
};
const format = (r: DoctorReport, style = plainStyle()) =>
  formatDoctorReport(r, { style, paths: { cwd, home } });

describe('formatDoctorReport', () => {
  it('groups checks under Setup, Agent hooks and Toolchain, with the same marks as init', () => {
    const lines = format(report).split('\n');
    expect(lines[0]).toBe('Setup');
    expect(lines).toContain('Agent hooks');
    expect(lines).toContain('Toolchain');
    // The git hook is part of setup, not an agent hook.
    expect(lines.indexOf('Agent hooks')).toBeGreaterThan(
      lines.findIndex((l) => l.includes('Git pre-commit hook')),
    );
    expect(lines.find((l) => l.includes('Allowlist'))).toMatch(/^ {2}✓ Allowlist/);
    expect(lines.find((l) => l.includes('bash/zsh'))).toMatch(/^ {2}✗ /);
    expect(lines.find((l) => l.includes('Git pre-commit'))).toMatch(/^ {2}! /);
  });

  it('puts the fix under each problem', () => {
    const lines = format(report).split('\n');
    const at = lines.findIndex((l) => l.includes('bash/zsh'));
    expect(lines[at + 1]).toBe('      fix: slopsquatshield init --shell');
  });

  it('shows paths relative to the project and ~ for home', () => {
    const out = format(report);
    expect(out).toContain('.slopsquatshield found at .slopsquatshield');
    expect(out).toContain(`Not installed in ~${sep}.bashrc`);
    expect(out).not.toContain(home);
  });

  it('ends with how many problems there are, or that all is well', () => {
    expect(format(report)).toContain('3 problems: run the fix lines above.');
    expect(format({ checks: [report.checks[0]] })).toContain('✓ All good.');
  });

  it('ends with the credit on a terminal only', () => {
    expect(
      format(report, plainStyle({ tty: true }))
        .split('\n')
        .at(-1),
    ).toBe(CREDIT);
    expect(format(report)).not.toContain(CREDIT);
  });
});
