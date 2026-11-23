// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { parseHookInput } from '../../src/hooks/hook-input.js';

describe('parseHookInput', () => {
  it.each(['claude-code', 'codex'] as const)(
    'reads the shared tool_name / tool_input.command / cwd shape for %s',
    (host) => {
      const raw = JSON.stringify({
        cwd: '/proj',
        tool_name: 'Bash',
        tool_input: { command: 'npm install x' },
      });
      expect(parseHookInput(host, raw)).toEqual({
        toolName: 'Bash',
        command: 'npm install x',
        cwd: '/proj',
      });
    },
  );

  it("reads Cursor's own beforeShellExecution payload: top-level command and cwd", () => {
    const raw = JSON.stringify({
      hook_event_name: 'beforeShellExecution',
      command: 'npm install x',
      cwd: '/proj',
      workspace_roots: ['/proj'],
    });
    expect(parseHookInput('cursor', raw)).toEqual({
      toolName: 'Bash',
      command: 'npm install x',
      cwd: '/proj',
      caller: 'cursor',
    });
  });

  it('falls back to workspace_roots[0] when Cursor sends no cwd', () => {
    const raw = JSON.stringify({ command: 'ls', workspace_roots: ['/ws'] });
    expect(parseHookInput('cursor', raw)?.cwd).toBe('/ws');
  });

  it('flags Cursor as the caller of a `hook claude-code` it imported from ~/.claude', () => {
    const raw = JSON.stringify({
      tool_name: 'Shell',
      tool_input: { command: 'npm install x' },
      workspace_roots: ['/proj'],
      cursor_version: '2.0.0',
    });
    const parsed = parseHookInput('claude-code', raw);
    expect(parsed?.caller).toBe('cursor');
    expect(parsed?.command).toBe('npm install x');
  });

  it('does not flag a plain Claude Code payload as Cursor', () => {
    const raw = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(parseHookInput('claude-code', raw)?.caller).toBeUndefined();
  });

  it('reads Antigravity run_command: toolCall.args.CommandLine and Cwd', () => {
    const raw = JSON.stringify({
      toolCall: { name: 'run_command', args: { CommandLine: 'pip install y', Cwd: '/p' } },
      stepIdx: 2,
    });
    expect(parseHookInput('antigravity', raw)).toEqual({
      toolName: 'run_command',
      command: 'pip install y',
      cwd: '/p',
    });
  });

  it('ignores CommandLine on any Antigravity tool other than run_command', () => {
    const raw = JSON.stringify({
      toolCall: { name: 'view_file', args: { CommandLine: 'npm install y' } },
    });
    expect(parseHookInput('antigravity', raw)?.command).toBe('');
  });

  it('does not read the Claude shape for Antigravity, nor the reverse', () => {
    const claude = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm i x' } });
    expect(parseHookInput('antigravity', claude)?.command).toBe('');
    const agy = JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'ls' } } });
    expect(parseHookInput('codex', agy)?.command).toBe('');
  });

  it.each(['not json', '', 'null', '42'])('returns undefined for unparseable input %j', (raw) => {
    expect(parseHookInput('claude-code', raw)).toBeUndefined();
    expect(parseHookInput('antigravity', raw)).toBeUndefined();
  });
});
