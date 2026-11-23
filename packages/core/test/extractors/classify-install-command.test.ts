// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyInstallCommand,
  extractInstallCommandDeps,
} from '../../src/extractors/install-command.js';

const CWD = '/proj';
const HOME = '/home/u';
const classify = (cmd: string) => classifyInstallCommand(cmd, { cwd: CWD, homeDir: HOME });
const installs = (cmd: string) =>
  classify(cmd).manifestInstalls.map((m) => ({
    tool: m.tool,
    dir: m.projectDir,
    files: m.files,
  }));
/** The same resolution the classifier uses, so expectations hold on Windows too. */
const under = (...parts: string[]) => resolve(CWD, ...parts);

describe('classifyInstallCommand: manifest-driven installs (#25)', () => {
  describe('npm', () => {
    it.each(['npm install', 'npm i', 'npm ci', 'npm install-clean', 'npm update', 'npm up'])(
      '%s installs the project manifest',
      (cmd) => {
        expect(installs(cmd)).toEqual([{ tool: 'npm', dir: CWD, files: undefined }]);
      },
    );

    it('also installs the manifest when packages are named (npm installs the whole tree)', () => {
      const c = classify('npm install left-pad');
      expect(c.named.map((d) => d.name)).toEqual(['left-pad']);
      expect(c.manifestInstalls).toHaveLength(1);
    });

    it.each(['npm install -g left-pad', 'npm i --global x', 'npm install -gD x'])(
      '%s installs that package alone, outside any project',
      (cmd) => expect(classify(cmd).manifestInstalls).toEqual([]),
    );

    it.each(['npm init', 'npm info left-pad', 'npm run build', 'npm test', 'npm --version'])(
      '%s is not an install',
      (cmd) => expect(classify(cmd).manifestInstalls).toEqual([]),
    );

    it('follows -C and --prefix to the directory npm will use', () => {
      expect(installs('npm install -C sub')[0]?.dir).toBe(under('sub'));
      expect(installs('npm ci --prefix=app')[0]?.dir).toBe(under('app'));
      expect(installs('npm ci --prefix /abs/app')[0]?.dir).toBe('/abs/app');
    });
  });

  describe('cd tracking', () => {
    it('attributes an install to the directory it follows', () => {
      expect(installs('cd app && npm ci')[0]?.dir).toBe(under('app'));
      expect(installs('cd a; cd b && npm ci')[0]?.dir).toBe(under('a', 'b'));
      expect(installs('cd /abs && npm ci')[0]?.dir).toBe('/abs');
      expect(installs('cd ~/work && npm ci')[0]?.dir).toBe(join(HOME, 'work'));
    });

    it('carries the directory across lines', () => {
      expect(installs('cd app\nnpm ci')[0]?.dir).toBe(under('app'));
    });

    it.each([
      'cd "$X" && npm ci',
      'cd - && npm ci',
      'cd $(mktemp -d) && npm ci',
      'cd a*/ && npm ci',
    ])('%s is not knowable statically: projectDir is undefined', (cmd) =>
      expect(installs(cmd)[0]?.dir).toBeUndefined(),
    );

    it('does not let a cd in one command affect an install before it', () => {
      expect(installs('npm ci && cd other')[0]?.dir).toBe(CWD);
    });
  });

  describe('pip', () => {
    it('pip install -r names the exact file, however it is spelled', () => {
      expect(installs('pip install -r req.txt')).toEqual([
        { tool: 'pip', dir: CWD, files: [under('req.txt')] },
      ]);
      expect(installs('pip install --requirement=a.txt -r b.txt')[0]?.files).toEqual([
        under('a.txt'),
        under('b.txt'),
      ]);
      expect(installs('pip3 install -rreq.txt')[0]?.files).toEqual([under('req.txt')]);
    });

    it('resolves the file relative to a cd', () => {
      expect(installs('cd api && pip install -r requirements.txt')[0]?.files).toEqual([
        under('api', 'requirements.txt'),
      ]);
    });

    it('pip install . and -e dir install that project', () => {
      expect(installs('pip install .')[0]).toEqual({
        tool: 'pip',
        dir: under('.'),
        files: undefined,
      });
      expect(installs('pip install -e ./lib')[0]?.dir).toBe(under('lib'));
    });

    it('pip install <names> alone is not manifest-driven', () => {
      expect(classify('pip install requests').manifestInstalls).toEqual([]);
      expect(classify('pip install ./pkg.whl').manifestInstalls).toEqual([]);
    });

    it('still names a package alongside -r', () => {
      const c = classify('pip install -r req.txt zz-ghost');
      expect(c.named.map((d) => d.name)).toEqual(['zz-ghost']);
      expect(c.manifestInstalls).toHaveLength(1);
    });
  });

  describe('uv, poetry, pipenv', () => {
    it('uv sync and uv add install the project (uv add also names a package)', () => {
      expect(installs('uv sync')).toEqual([{ tool: 'uv', dir: CWD, files: undefined }]);
      const add = classify('uv add httpx');
      expect(add.named.map((d) => d.name)).toEqual(['httpx']);
      expect(add.manifestInstalls.map((m) => m.tool)).toEqual(['uv']);
    });

    it('uv sync --directory follows the flag', () => {
      expect(installs('uv sync --directory svc')[0]?.dir).toBe(under('svc'));
    });

    it('uv pip install -r and uv pip sync name their files', () => {
      expect(installs('uv pip install -r r.txt')[0]).toEqual({
        tool: 'uv',
        dir: CWD,
        files: [under('r.txt')],
      });
      expect(installs('uv pip sync r.txt')[0]?.files).toEqual([under('r.txt')]);
    });

    it('poetry install / add, with -C', () => {
      expect(installs('poetry install')[0]?.tool).toBe('poetry');
      expect(installs('poetry install -C svc')[0]?.dir).toBe(under('svc'));
      expect(classify('poetry add httpx').named.map((d) => d.name)).toEqual(['httpx']);
    });

    it('pipenv install / sync', () => {
      expect(installs('pipenv install')).toEqual([{ tool: 'pipenv', dir: CWD, files: undefined }]);
      expect(installs('pipenv sync')).toHaveLength(1);
    });
  });

  describe('mvn', () => {
    it.each([
      'mvn test',
      'mvn clean install',
      './mvnw package',
      'mvn -B verify',
      'mvn dependency:tree',
    ])('%s resolves the project dependencies', (cmd) => expect(installs(cmd)[0]?.tool).toBe('mvn'));

    it.each(['mvn clean', 'mvn -v', 'mvn --version', 'mvn help:effective-pom', 'mvn validate'])(
      '%s resolves nothing',
      (cmd) => expect(classify(cmd).manifestInstalls).toEqual([]),
    );

    it('dependency:get is a named install, not a manifest one', () => {
      const c = classify('mvn dependency:get -Dartifact=g:a:1.0');
      expect(c.named.map((d) => d.name)).toEqual(['g:a']);
      expect(c.manifestInstalls).toEqual([]);
    });

    it('-f names the POM', () => {
      expect(installs('mvn -f sub/pom.xml package')[0]).toEqual({
        tool: 'mvn',
        dir: undefined,
        files: [under('sub', 'pom.xml')],
      });
    });
  });

  describe('what is not an install at all', () => {
    it.each([
      'echo "npm install"',
      'ls | grep npm',
      'git commit -m "npm ci"',
      "cat > README.md <<'EOF'\nnpm install\nEOF",
    ])('%j', (cmd) => expect(classify(cmd).manifestInstalls).toEqual([]));

    it('a heredoc fed to a shell does run', () => {
      expect(classify('bash <<EOF\nnpm ci\nEOF').manifestInstalls).toHaveLength(1);
    });
  });

  it('without a cwd, installs are still recognised but their directory is unknown', () => {
    const c = classifyInstallCommand('npm ci', {});
    expect(c.manifestInstalls).toHaveLength(1);
    expect(c.manifestInstalls[0]?.projectDir).toBeUndefined();
  });
});

describe('extractInstallCommandDeps is unchanged: a view over the named packages', () => {
  it.each([
    'npm install left-pad express@4',
    'cd app && pip install requests zz-ghost',
    'uv add httpx',
    'poetry add "requests[security]@^2"',
    'mvn dependency:get -Dartifact=org.x:y:1.0',
    'npm install -g --prefix ~/tools left-pad',
    'npm install && echo done',
    'npm ci',
    'ls -la',
  ])('%s', (cmd) => {
    expect(extractInstallCommandDeps(cmd)).toEqual(classifyInstallCommand(cmd).named);
  });
});

describe('classifyInstallCommand: other spellings of the same install (hook bypasses)', () => {
  const names = (cmd: string) => classify(cmd).named.map((d) => d.name);

  describe('npm options before the subcommand', () => {
    it.each([
      ['npm --prefix sub install ghost-x', under('sub')],
      ['npm -C sub i ghost-x', under('sub')],
      ['npm --prefix=sub install ghost-x', under('sub')],
      ['npm --registry https://r.example install ghost-x', CWD],
      ['npm -w pkg-a install ghost-x', CWD],
    ])('%s checks the named package and the right project', (cmd, dir) => {
      expect(names(cmd)).toEqual(['ghost-x']);
      expect(installs(cmd)).toEqual([{ tool: 'npm', dir, files: undefined }]);
    });

    it('a bare install with a leading --prefix reads that project', () => {
      expect(installs('npm --prefix sub ci')).toEqual([
        { tool: 'npm', dir: under('sub'), files: undefined },
      ]);
    });

    it('a leading -g is still a global install of that package alone', () => {
      expect(names('npm -g install ghost-x')).toEqual(['ghost-x']);
      expect(classify('npm --global install ghost-x').manifestInstalls).toEqual([]);
    });

    it('keeps quoted values whole', () => {
      expect(names('npm --prefix "my dir" install "ghost@^1 || ^2"')).toEqual(['ghost']);
    });

    it.each(['npm --version', 'npm --prefix sub', 'npm --prefix sub run build'])(
      '%s is still not an install',
      (cmd) => expect(classify(cmd)).toEqual({ named: [], manifestInstalls: [] }),
    );
  });

  describe('python -m pip', () => {
    it.each([
      'python -m pip install ghost-y',
      'python3 -m pip install ghost-y',
      'python3.12 -m pip install ghost-y',
      'py -3.12 -m pip install ghost-y',
      '.venv/bin/python -m pip install ghost-y',
      'C:\\Python312\\python.exe -m pip install ghost-y',
      'python -I -m pip install ghost-y',
      'python -m pip3 install ghost-y',
      'sudo python3 -m pip install ghost-y',
      'cd app && python -m pip install ghost-y',
    ])('%s checks the package', (cmd) => {
      expect(names(cmd)).toEqual(['ghost-y']);
    });

    it('python -m pip install -r reads the requirements file', () => {
      expect(installs('python -m pip install -r requirements.txt')).toEqual([
        { tool: 'pip', dir: CWD, files: [under('requirements.txt')] },
      ]);
    });

    it.each([
      'python -m pip --version',
      'python -m pipx install black',
      'python -m venv .venv',
      'python -m pytest',
      'echo "python -m pip install ghost-y"',
    ])('%s is not a pip install', (cmd) => {
      expect(classify(cmd)).toEqual({ named: [], manifestInstalls: [] });
    });
  });

  describe('a package manager called by path, with an extension, or versioned', () => {
    it.each([
      ['.venv/bin/pip install ghost-y', 'ghost-y'],
      ['venv\\Scripts\\pip.exe install ghost-y', 'ghost-y'],
      ['pip.exe install ghost-y', 'ghost-y'],
      ['pip3.12 install ghost-y', 'ghost-y'],
      ['/usr/bin/npm install ghost-x', 'ghost-x'],
      ['./node_modules/.bin/npm install ghost-x', 'ghost-x'],
      ['npm.cmd install ghost-x', 'ghost-x'],
      ['NPM.CMD install ghost-x', 'ghost-x'],
      ['"C:\\Program Files\\nodejs\\npm.cmd" install ghost-x', 'ghost-x'],
      ['/usr/bin/npm --prefix sub install ghost-x', 'ghost-x'],
      ['/opt/bin/uv add ghost-y', 'ghost-y'],
      ['~/.local/bin/poetry add ghost-y', 'ghost-y'],
      ['./mvnw dependency:get -Dartifact=g:ghost-m:1', 'g:ghost-m'],
    ])('%s checks the package', (cmd, name) => {
      expect(names(cmd)).toEqual([name]);
    });

    it('.venv/bin/pip install -r reads the requirements file', () => {
      expect(installs('.venv/bin/pip install -r requirements.txt')).toEqual([
        { tool: 'pip', dir: CWD, files: [under('requirements.txt')] },
      ]);
    });

    it.each(['./mvnw test', 'mvnw.cmd test'])('%s installs the project POM', (cmd) => {
      expect(installs(cmd)).toEqual([{ tool: 'mvn', dir: CWD, files: undefined }]);
    });

    it.each([
      '/usr/bin/npmx install ghost-x',
      'tools/pip-audit install ghost-y',
      './npm-helper.sh install ghost-x',
      'mypip install ghost-y',
      'pipx install black',
      '/usr/bin/npm --version',
      'echo /usr/bin/npm install ghost-x',
    ])('%s is left alone', (cmd) => {
      expect(classify(cmd)).toEqual({ named: [], manifestInstalls: [] });
    });
  });
});
