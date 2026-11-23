// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { extractInstallCommandDeps } from '../../src/extractors/install-command.js';
import { runHookCheck } from '../../src/hooks/run-hook-check.js';
import { server } from '../msw/server.js';

// onUnhandledRequest: 'error' — any registry call in these tests fails them.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// An agent writing a POM test fixture with a made-up coordinate: file content, not an install.
const HEREDOC = [
  "cat > pom.xml <<'EOF'",
  '<project><dependencies>',
  '  <dependency>',
  '    <groupId>org.example.fixture</groupId>',
  '    <artifactId>not-a-real-artifact</artifactId>',
  '  </dependency>',
  '</dependencies></project>',
  'EOF',
].join('\n');

describe('pasted <dependency> blocks in a live command (hook false positive)', () => {
  it('are still extracted by default — FR-1.4/1.5 document extraction is unchanged', () => {
    const deps = extractInstallCommandDeps(HEREDOC);
    expect(deps.map((d) => d.name)).toEqual(['org.example.fixture:not-a-real-artifact']);
  });

  it('are skipped when the caller says the text is a live shell command', () => {
    expect(extractInstallCommandDeps(HEREDOC, undefined, { includeXmlBlocks: false })).toEqual([]);
  });

  it('the agent hook allows a heredoc that writes a POM fixture, with zero registry calls', async () => {
    const result = await runHookCheck({ toolName: 'Bash', command: HEREDOC });

    expect(result.decision).toBe('allow');
    expect(result.reason).toBe('not a recognized install command');
    expect(result.verdicts).toEqual([]);
  });

  it('still catches a real install line sitting in the same command text', () => {
    const command = `${HEREDOC}\nmvn dependency:get -Dartifact=org.example.fixture:real-looking:1.0`;
    const deps = extractInstallCommandDeps(command, undefined, { includeXmlBlocks: false });
    expect(deps.map((d) => d.name)).toEqual(['org.example.fixture:real-looking']);
  });
});
