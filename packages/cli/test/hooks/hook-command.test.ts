// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isOurHookCommand } from '../../src/hooks/hook-command.js';

describe('isOurHookCommand', () => {
  it.each([
    'slopsquatshield hook claude-code',
    '"$HOME/.config/slopsquatshield/bin/slopsquatshield" hook claude-code',
    '/home/user/.nvm/versions/node/v24.21.0/bin/slopsquatshield hook claude-code',
    '"C:\\Users\\a\\.config\\slopsquatshield\\bin\\slopsquatshield.cmd" hook claude-code',
    '  slopsquatshield   hook   claude-code  ',
  ])('recognises %s', (command) => {
    expect(isOurHookCommand(command, 'claude-code')).toBe(true);
  });

  it.each([
    'some-other-tool',
    'slopsquatshield hook cursor', // wrong host
    'notslopsquatshield hook claude-code',
    'slopsquatshield hook claude-code --extra',
    undefined,
    42,
  ])('rejects %s', (command) => {
    expect(isOurHookCommand(command, 'claude-code')).toBe(false);
  });
});
