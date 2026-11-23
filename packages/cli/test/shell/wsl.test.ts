// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('detectWslHome', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('returns undefined immediately on a non-win32 platform, without spawning anything', async () => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const execFileSync = vi.fn();
    vi.doMock('node:child_process', () => ({ execFileSync }));

    const { detectWslHome } = await import('../../src/shell/wsl.js');
    const result = detectWslHome();

    expect(result).toBeUndefined();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('returns undefined when wsl.exe is missing (Windows without WSL installed)', async () => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const execFileSync = vi.fn(() => {
      throw new Error('spawn wsl.exe ENOENT');
    });
    vi.doMock('node:child_process', () => ({ execFileSync }));

    const { detectWslHome } = await import('../../src/shell/wsl.js');
    const result = detectWslHome();

    expect(result).toBeUndefined();
  });

  it('parses distro name and both home paths on a successful detection', async () => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const execFileSync = vi
      .fn()
      .mockReturnValueOnce('Ubuntu\n')
      .mockReturnValueOnce('/home/user\n\\\\wsl.localhost\\Ubuntu\\home\\user\n');
    vi.doMock('node:child_process', () => ({ execFileSync }));

    const { detectWslHome } = await import('../../src/shell/wsl.js');
    const result = detectWslHome();

    expect(result).toEqual({
      distro: 'Ubuntu',
      posixPath: '/home/user',
      windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\user',
    });
  });

  it('returns undefined when the distro name comes back empty', async () => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const execFileSync = vi.fn().mockReturnValueOnce('\n');
    vi.doMock('node:child_process', () => ({ execFileSync }));

    const { detectWslHome } = await import('../../src/shell/wsl.js');
    const result = detectWslHome();

    expect(result).toBeUndefined();
  });
});
