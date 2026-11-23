// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { HookHost } from './hook-command.js';

/** What every host's stdin payload is normalised to before the shared check runs. */
export interface HookInput {
  toolName: string;
  command: string;
  /** The session's working directory when the host reports one. */
  cwd?: string;
  /**
   * Set when the payload shows Cursor is the real caller — either `hook cursor`, or Cursor
   * running a hook it imported from `~/.claude/settings.json` (it sends `workspace_roots` /
   * `cursor_version`). Lets the Claude Code adapter answer Cursor in a way Cursor understands.
   */
  caller?: 'cursor';
}

interface ClaudeShape {
  cwd?: string;
  tool_name?: string;
  tool_input?: { command?: string };
  /** Cursor's `beforeShellExecution` puts the command at the top level instead. */
  command?: string;
  workspace_roots?: string[];
  cursor_version?: string;
}

interface AntigravityShape {
  toolCall?: { name?: string; args?: { CommandLine?: string; Cwd?: string } };
}

/**
 * Parses a host's PreToolUse stdin into a `HookInput`. Claude Code and Codex share one shape
 * (`tool_name`, `tool_input.command`, `cwd`); Cursor's own `beforeShellExecution` payload has a
 * top-level `command` and `cwd` (and `workspace_roots`); Antigravity differs
 * (`toolCall.name === 'run_command'`, `toolCall.args.CommandLine`/`Cwd`). Returns `undefined`
 * for anything unparseable — the caller fails open rather than crashing (NFR-3.1).
 */
export function parseHookInput(host: HookHost, raw: string): HookInput | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  if (host === 'antigravity') {
    const call = (parsed as AntigravityShape).toolCall;
    return {
      toolName: call?.name ?? '',
      // Only shell commands carry an install to check; other tools pass through unexamined.
      command: call?.name === 'run_command' ? (call.args?.CommandLine ?? '') : '',
      cwd: call?.args?.Cwd,
    };
  }

  const shape = parsed as ClaudeShape;
  const fromCursor =
    host === 'cursor' ||
    Array.isArray(shape.workspace_roots) ||
    typeof shape.cursor_version === 'string';
  const command =
    shape.tool_input?.command ?? (typeof shape.command === 'string' ? shape.command : '');
  return {
    toolName: shape.tool_name ?? 'Bash',
    command,
    cwd: shape.cwd ?? (fromCursor ? shape.workspace_roots?.[0] : undefined),
    ...(fromCursor ? { caller: 'cursor' as const } : {}),
  };
}
