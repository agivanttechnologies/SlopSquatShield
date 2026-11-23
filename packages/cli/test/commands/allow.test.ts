// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAllow } from '../../src/commands/allow.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ssg-allow-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runAllow (FR-5.3)', () => {
  it('creates .slopsquatshield when absent', () => {
    expect(runAllow(dir, 'my-internal-pkg')).toBe('added');
    expect(readFileSync(join(dir, '.slopsquatshield'), 'utf-8')).toBe('my-internal-pkg\n');
  });

  it('appends, keeping existing lines and comments', () => {
    writeFileSync(join(dir, '.slopsquatshield'), '# mine\nfoo');
    runAllow(dir, 'org.example:bar');
    expect(readFileSync(join(dir, '.slopsquatshield'), 'utf-8')).toBe(
      '# mine\nfoo\norg.example:bar\n',
    );
  });

  it('is idempotent', () => {
    runAllow(dir, 'foo');
    expect(runAllow(dir, 'foo')).toBe('already-present');
    expect(readFileSync(join(dir, '.slopsquatshield'), 'utf-8')).toBe('foo\n');
  });

  it.each(['', '  ', 'two words', 'a#b'])('rejects the invalid identifier %j', (id) => {
    expect(() => runAllow(dir, id)).toThrow(/not a valid allowlist identifier/);
  });
});
