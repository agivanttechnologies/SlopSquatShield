// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { locateDependency } from '../src/locate.js';

const slice = (
  text: string,
  r: { start: { line: number; character: number }; end: { line: number; character: number } },
) => text.split('\n')[r.start.line].slice(r.start.character, r.end.character);

describe('locateDependency — package.json', () => {
  const text = `{
  "name": "demo",
  "dependencies": {
    "left-pad": "^1.0.0",
    "express": "^4.0.0"
  },
  "devDependencies": {
    "jest": "^29"
  }
}`;

  it('finds a dependency in any dependency section, ranged over the quoted name', () => {
    const loc = locateDependency('/x/package.json', text, 'express');
    expect(slice(text, loc?.range as never)).toBe('"express"');
    expect(loc?.range.start.line).toBe(4);
    expect(locateDependency('package.json', text, 'jest')?.range.start.line).toBe(7);
  });

  it('does not match the package’s own "name" field or a name outside the dependency sections', () => {
    expect(locateDependency('package.json', text, 'demo')).toBeUndefined();
    expect(locateDependency('package.json', text, 'nonexistent')).toBeUndefined();
  });

  it('offers whole-line removal only when the entry is alone on its line', () => {
    expect(locateDependency('package.json', text, 'left-pad')?.lines).toEqual({
      startLine: 3,
      endLine: 3,
    });
    const oneLine = '{ "dependencies": { "a": "1", "b": "2" } }';
    expect(locateDependency('package.json', oneLine, 'a')?.lines).toBeUndefined();
  });

  it('handles scoped names and braces inside strings', () => {
    const t = '{\n  "dependencies": {\n    "@scope/pkg": "1.0.0",\n    "weird": "{}"\n  }\n}';
    expect(slice(t, locateDependency('package.json', t, '@scope/pkg')?.range as never)).toBe(
      '"@scope/pkg"',
    );
    expect(locateDependency('package.json', t, 'weird')?.range.start.line).toBe(3);
  });
});

describe('locateDependency — Python', () => {
  it('requirements.txt: matches by PEP 503-normalised name, skipping comments and options', () => {
    const text = '# flask\n-r other.txt\nFlask_Login>=0.6\nrequests[socks]==2.0\n';
    const flask = locateDependency('requirements.txt', text, 'flask-login');
    expect(slice(text, flask?.range as never)).toBe('Flask_Login');
    expect(flask?.lines).toEqual({ startLine: 2, endLine: 2 });
    expect(
      slice(text, locateDependency('requirements.txt', text, 'requests')?.range as never),
    ).toBe('requests');
    expect(locateDependency('requirements.txt', text, 'flask')).toBeUndefined();
  });

  it('pyproject.toml: PEP 621 array items and Poetry keys', () => {
    const text = `[project]
dependencies = [
  "requests>=2",
  "numpy",
]
[tool.poetry.dependencies]
python = "^3.11"
flask = "^3.0"
`;
    expect(slice(text, locateDependency('pyproject.toml', text, 'numpy')?.range as never)).toBe(
      'numpy',
    );
    expect(slice(text, locateDependency('pyproject.toml', text, 'flask')?.range as never)).toBe(
      'flask',
    );
    expect(locateDependency('pyproject.toml', text, 'python')).toBeUndefined(); // a version pin, not a dep
  });

  it('Pipfile: key lines, quoted or not', () => {
    const text = '[packages]\nrequests = "*"\n"django" = {version = ">=4"}\n';
    expect(slice(text, locateDependency('Pipfile', text, 'requests')?.range as never)).toBe(
      'requests',
    );
    expect(slice(text, locateDependency('Pipfile', text, 'django')?.range as never)).toBe('django');
  });
});

describe('locateDependency — pom.xml', () => {
  const pom = `<project>
  <dependencies>
    <dependency>
      <groupId>org.apache.commons</groupId>
      <artifactId>commons-lang3</artifactId>
      <version>3.12.0</version>
    </dependency>
    <dependency>
      <groupId>org.other</groupId>
      <artifactId>commons-lang3</artifactId>
    </dependency>
  </dependencies>
</project>`;

  it('matches groupId AND artifactId, ranging over the artifactId text', () => {
    const loc = locateDependency('pom.xml', pom, 'org.other:commons-lang3');
    expect(slice(pom, loc?.range as never)).toBe('commons-lang3');
    expect(loc?.range.start.line).toBe(9); // the second block, not the first
    expect(loc?.lines).toEqual({ startLine: 7, endLine: 10 });
  });

  it('returns undefined for coordinates that are not declared', () => {
    expect(locateDependency('pom.xml', pom, 'org.nope:missing')).toBeUndefined();
  });
});

describe('locateDependency — misc', () => {
  it('returns undefined for an unsupported file', () => {
    expect(locateDependency('README.md', 'express', 'express')).toBeUndefined();
  });
  it('handles CRLF files', () => {
    const text = 'flask\r\nrequests\r\n';
    const loc = locateDependency('requirements.txt', text, 'requests');
    expect(loc?.range.start).toEqual({ line: 1, character: 0 });
    expect(loc?.range.end).toEqual({ line: 1, character: 8 });
  });
});
