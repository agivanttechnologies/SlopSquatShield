// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyInstallCommand,
  extractInstallCommandDeps,
} from '../../src/extractors/install-command.js';
import { runHookCheck } from '../../src/hooks/run-hook-check.js';
import { server } from '../msw/server.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const names = (command: string) =>
  extractInstallCommandDeps(command, undefined, { includeXmlBlocks: false }).map((d) => d.name);

describe('installs that are not the first command on the line (a hook bypass until now)', () => {
  it.each([
    ['cd app && npm install ghost-pkg', ['ghost-pkg']],
    ['cd app; npm install ghost-pkg', ['ghost-pkg']],
    ['make build || npm install ghost-pkg', ['ghost-pkg']],
    ['echo hi | npm install ghost-pkg', ['ghost-pkg']],
    ['(cd app && pip install ghost-py)', ['ghost-py']],
    ['{ npm install ghost-pkg; }', ['ghost-pkg']],
    ['echo $(npm install ghost-pkg)', ['ghost-pkg']],
    ['npm run build && npm install a && pip install b', ['a', 'b']],
  ])('%s', (command, expected) => {
    expect(names(command)).toEqual(expected);
  });

  it('strips env assignments and transparent wrappers before the command', () => {
    expect(names('FOO=bar npm install ghost-pkg')).toEqual(['ghost-pkg']);
    expect(names('sudo npm install ghost-pkg')).toEqual(['ghost-pkg']);
    expect(names('time npm i ghost-pkg')).toEqual(['ghost-pkg']);
    expect(names('NODE_ENV=production sudo -E npm install ghost-pkg')).toEqual(['ghost-pkg']);
    expect(names('cd x && CI=1 npm install ghost-pkg')).toEqual(['ghost-pkg']);
  });
});

describe('shell operators are never mistaken for package names', () => {
  it.each([
    ['npm install foo | tail -5', ['foo']],
    ['npm install foo && npm run build', ['foo']],
    ['npm install foo; echo done', ['foo']],
    ['npm install foo 2>&1 | tail -5', ['foo']],
    ['npm install foo > install.log', ['foo']],
    ['npm install foo &> install.log', ['foo']],
    ['npm install foo < /dev/null', ['foo']],
    ['npm install foo & echo started', ['foo']],
    ['npm install --package-lock-only 2>&1 | tail -3; npx biome check', []],
    ['npm install --package-lock-only && npm run build', []],
  ])('%s', (command, expected) => {
    expect(names(command)).toEqual(expected);
  });

  it('no operator character ever becomes a dependency name', () => {
    const all = names('npm install a 2>&1 | tail -3 && npm i b; pip install c > o 2>&1 &');
    expect(all).toEqual(['a', 'b', 'c']);
    for (const n of all) expect(n).toMatch(/^[A-Za-z0-9@._/-]+$/);
  });
});

describe('the value of an option is never mistaken for a package name', () => {
  // Found in pre-release testing: each of these was DENIED by the hook (`~/tools`, `packages/cli`,
  // `https`, `constraints.txt` reported as nonexistent or low-download packages).
  it.each([
    ['npm install -g --prefix ~/tools left-pad', ['left-pad']],
    ['npm install left-pad -w packages/cli', ['left-pad']],
    ['npm i -D left-pad --workspace web', ['left-pad']],
    ['npm install --tag next left-pad', ['left-pad']],
    ['npm install --registry registry.example.com left-pad', ['left-pad']],
    ['npm install -C ../app left-pad', ['left-pad']],
    ['npm install --prefix=/opt/x left-pad', ['left-pad']],
    ['pip install -t vendor requests', ['requests']],
    ['pip install -c constraints.txt requests', ['requests']],
    ['pip install -i https://pypi.org/simple requests', ['requests']],
    ['pip install --index-url https://pypi.org/simple requests', ['requests']],
    ['pip install --extra-index-url https://x.example/simple requests', ['requests']],
    ['uv add --group dev pytest', ['pytest']],
    ['uv pip install -p 3.12 requests', ['requests']],
    ['poetry add -G dev pytest', ['pytest']],
    ['poetry add --source internal requests', ['requests']],
  ])('%s', (command, expected) => {
    expect(names(command)).toEqual(expected);
  });

  it('a package after -r / -e is still checked (the whole line used to be skipped)', () => {
    expect(names('pip install -r requirements.txt ghost-py')).toEqual(['ghost-py']);
    expect(names('pip install -e . ghost-py')).toEqual(['ghost-py']);
    expect(names('pip install -e git+https://github.com/a/b.git ghost-py')).toEqual(['ghost-py']);
  });

  it('boolean flags still do not swallow the package after them', () => {
    expect(names('npm install -g zz-ghost')).toEqual(['zz-ghost']);
    expect(names('npm install --save-dev zz-ghost')).toEqual(['zz-ghost']);
    expect(names('pip install -U zz-ghost')).toEqual(['zz-ghost']);
    expect(names('pip install --user zz-ghost')).toEqual(['zz-ghost']);
    expect(names('poetry add --dev zz-ghost')).toEqual(['zz-ghost']);
  });
});

describe('quoting is respected', () => {
  it('text inside quotes is not a command', () => {
    expect(names('echo "npm install ghost-pkg"')).toEqual([]);
    expect(names("echo 'cd x && npm install ghost-pkg'")).toEqual([]);
    expect(names('git commit -m "npm install ghost-pkg; done"')).toEqual([]);
  });

  it('a quoted version range with operator characters stays one token', () => {
    expect(extractInstallCommandDeps('npm install "left-pad@^1 || ^2"')).toMatchObject([
      { name: 'left-pad', specifier: '^1 || ^2' },
    ]);
    expect(names('pip install "flask>=2,<3"')).toEqual(['flask']);
  });

  it('keeps the existing single-command behaviour', () => {
    expect(names('npm install express lodash@4')).toEqual(['express', 'lodash']);
    expect(names('pip install -r requirements.txt')).toEqual([]);
    expect(names('npm run build')).toEqual([]);
  });
});

describe('the agent hook, end to end through runHookCheck', () => {
  function mockMissing(name: string): void {
    server.use(
      http.get(`https://api.deps.dev/v3/systems/NPM/packages/${name}`, () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
  }

  it('now DENIES a hallucinated package installed after `cd … &&` (it used to be skipped)', async () => {
    mockMissing('zz-ghost-after-cd');

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'cd frontend && npm install zz-ghost-after-cd',
    });

    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('zz-ghost-after-cd');
  });

  it('DENIES a hallucinated package hidden behind a popular alias name (`lodash@npm:…`)', async () => {
    // Only the real target is mocked: a lookup of `lodash` would be an unhandled request.
    mockMissing('zz-ghost-behind-alias');

    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install lodash@npm:zz-ghost-behind-alias',
    });

    expect(result.decision).toBe('deny');
    expect(result.reason).toContain('zz-ghost-behind-alias');
  });

  it('does not deny a normal piped install with no packages in it (it used to produce fake BLOCKs)', async () => {
    // No registry mock at all: any lookup of a fake "package" would be an unhandled request.
    const result = await runHookCheck({
      toolName: 'Bash',
      command: 'npm install --package-lock-only 2>&1 | tail -3; npx biome check',
    });

    expect(result.decision).toBe('allow');
    expect(result.verdicts).toEqual([]);
  });
});

describe('heredocs: a body that only writes data is not scanned (it is not executed)', () => {
  const body = (opener: string, lines: string[], terminator = 'EOF') =>
    [opener, ...lines, terminator].join('\n');

  it.each([
    ["cat > README.md <<'EOF'", 'EOF'],
    ['cat > README.md <<EOF', 'EOF'],
    ['cat > notes.md << "DOC"', 'DOC'],
    ['tee setup.md <<-END', 'END'],
    ['python3 - <<PY', 'PY'],
    ['git commit -F - <<MSG', 'MSG'],
  ])('%s — prose with an install in it is data', (opener, terminator) => {
    const command = body(
      opener,
      ['Run `cd app && npm install some-ghost-package` to start.', 'npm install ghost-pkg'],
      terminator,
    );
    expect(names(command)).toEqual([]);
  });

  it('a heredoc fed to a shell DOES run, so an install inside it is still caught', () => {
    expect(names(body('bash <<EOF', ['cd app', 'npm install ghost-pkg']))).toEqual(['ghost-pkg']);
    expect(names(body('sh <<-EOF', ['pip install ghost-py']))).toEqual(['ghost-py']);
    expect(names(body('sudo bash <<EOF', ['npm i ghost-pkg']))).toEqual(['ghost-pkg']);
    expect(names(body('ssh host bash <<EOF', ['npm i ghost-pkg']))).toEqual(['ghost-pkg']);
  });

  it('commands after the terminator are scanned normally again', () => {
    const command = `${body("cat > f <<'EOF'", ['npm install inside-data'])}\nnpm install after-heredoc`;
    expect(names(command)).toEqual(['after-heredoc']);
  });

  it('a command on the opener line itself is still scanned', () => {
    expect(names(body('npm install on-opener-line <<EOF', ['ignored']))).toEqual([
      'on-opener-line',
    ]);
  });

  it('a here-string (<<<) is not a heredoc, so nothing after it is skipped', () => {
    expect(names('cat <<< "hello"\nnpm install real-pkg')).toEqual(['real-pkg']);
  });

  it('an unterminated heredoc swallows the rest as data rather than guessing', () => {
    expect(names("cat > f <<'EOF'\nnpm install inside\nnpm install also-inside")).toEqual([]);
  });

  it('the agent hook allows writing a file whose text mentions an install (no registry call)', async () => {
    const result = await runHookCheck({
      toolName: 'Bash',
      command: body("cat > NOTES.md <<'EOF'", [
        '## Setup',
        'First `cd app && npm install some-ghost-package`, then run the tests.',
      ]),
    });
    expect(result.decision).toBe('allow');
    expect(result.verdicts).toEqual([]);
  });
});

describe('a cd inside a subshell does not outlive it', () => {
  /** Each manifest install's directory, as a POSIX path (Windows adds a drive and backslashes). */
  const installDirs = (command: string) =>
    classifyInstallCommand(command, { cwd: '/proj', includeXmlBlocks: false }).manifestInstalls.map(
      (m) => m.projectDir?.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''),
    );

  it.each([
    ['(cd /tmp/empty) && npm install', ['/proj']],
    ['(cd docs && echo hi); npm ci', ['/proj']],
    ['echo $(cd docs && pwd) && npm ci', ['/proj']],
    ['(cd app && npm ci)', ['/proj/app']],
    ['(cd a && (cd b) && npm ci)', ['/proj/a']],
    ['cd app && (cd sub) && npm ci', ['/proj/app']],
  ])('%s', (command, expected) => {
    expect(installDirs(command)).toEqual(expected);
  });

  it('keeps tracking across lines', () => {
    expect(installDirs('(cd docs\nnpm ci)\nnpm ci')).toEqual(['/proj/docs', '/proj']);
  });

  it('ignores an unmatched ")"', () => {
    expect(installDirs('cd app; ) ; npm ci')).toEqual(['/proj/app']);
  });
});

describe('npm aliases are checked as the package they install', () => {
  it.each([
    ['npm install lodash@npm:react-codeshift', 'react-codeshift', 'lodash'],
    ['npm i @types/node@npm:evil-pkg@1.0.0', 'evil-pkg', '@types/node'],
    ['npm install x@npm:@evil/pkg@^2', '@evil/pkg', 'x'],
  ])('%s', (command, name, alias) => {
    expect(
      extractInstallCommandDeps(command, undefined, { includeXmlBlocks: false }),
    ).toMatchObject([{ name, alias, ecosystem: 'npm' }]);
  });
});
