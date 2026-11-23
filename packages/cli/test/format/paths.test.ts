// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { displayPath } from '../../src/format/paths.js';

// Absolute paths in whatever form this OS uses, so the test holds on Windows too.
const root = join(sep, 'work');
const home = join(sep, 'home', 'me');
const ctx = { cwd: join(home, 'proj'), home };

describe('displayPath', () => {
  it('is relative inside the current directory', () => {
    expect(displayPath(join(home, 'proj', 'package.json'), ctx)).toBe('package.json');
    expect(displayPath(join(home, 'proj', 'apps', 'web', 'package.json'), ctx)).toBe(
      join('apps', 'web', 'package.json'),
    );
    expect(displayPath(join(home, 'proj'), ctx)).toBe('.');
  });

  it('uses ~ under the home directory', () => {
    expect(displayPath(join(home, '.bashrc'), ctx)).toBe(`~${sep}.bashrc`);
    expect(displayPath(home, ctx)).toBe('~');
  });

  it('stays absolute everywhere else', () => {
    expect(displayPath(join(root, 'x'), ctx)).toBe(join(root, 'x'));
  });

  it('does not treat a sibling that shares a prefix as inside', () => {
    expect(displayPath(join(sep, 'home', 'me2', 'x'), ctx)).toBe(join(sep, 'home', 'me2', 'x'));
  });

  it('leaves a relative path alone', () => {
    expect(displayPath('package.json', ctx)).toBe('package.json');
  });
});
