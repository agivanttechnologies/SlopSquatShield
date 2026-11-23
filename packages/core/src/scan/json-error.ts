// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
export interface JsonErrorLocation {
  offset: number;
  reason: string;
}

/**
 * Finds where `text` stops being valid JSON. `JSON.parse`'s own messages don't reliably carry a
 * position (Node 24 often omits it), so once `JSON.parse` has already thrown, this strict scanner
 * re-reads the text to recover an exact offset for the error report. It is only ever used to
 * *locate* an error `JSON.parse` already found — it never accepts or rejects input on its own.
 * Returns `undefined` if it finds no fault (then the caller falls back to `JSON.parse`'s message).
 */
export function locateJsonError(text: string): JsonErrorLocation | undefined {
  let pos = 0;

  const fail = (reason: string, at = pos): never => {
    throw { offset: at, reason } satisfies JsonErrorLocation;
  };
  const describe = (): string =>
    pos >= text.length ? 'Unexpected end of JSON input' : `Unexpected token '${text[pos]}'`;
  const skipWs = (): void => {
    while (pos < text.length && /[ \t\n\r]/.test(text[pos])) pos++;
  };

  function parseString(): void {
    pos++; // opening quote
    while (pos < text.length) {
      const c = text[pos];
      if (c === '"') {
        pos++;
        return;
      }
      if (c === '\\') {
        pos += 2;
        continue;
      }
      if (c === '\n') fail('Unterminated string');
      pos++;
    }
    fail('Unterminated string', text.length);
  }

  function parseValue(): void {
    skipWs();
    const c = text[pos];
    if (c === '{') {
      parseObject();
      return;
    }
    if (c === '[') {
      parseArray();
      return;
    }
    if (c === '"') {
      parseString();
      return;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(pos));
      if (!m) fail(describe());
      pos += (m as RegExpExecArray)[0].length;
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, pos)) {
        pos += literal.length;
        return;
      }
    }
    fail(describe());
  }

  function parseObject(): void {
    pos++; // {
    skipWs();
    if (text[pos] === '}') {
      pos++;
      return;
    }
    for (;;) {
      skipWs();
      if (text[pos] !== '"') fail(`Expected a property name, ${describe()}`);
      parseString();
      skipWs();
      if (text[pos] !== ':') fail(`Expected ':' after property name, ${describe()}`);
      pos++;
      parseValue();
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === '}') {
        pos++;
        return;
      }
      fail(`Expected ',' or '}', ${describe()}`);
    }
  }

  function parseArray(): void {
    pos++; // [
    skipWs();
    if (text[pos] === ']') {
      pos++;
      return;
    }
    for (;;) {
      parseValue();
      skipWs();
      if (text[pos] === ',') {
        pos++;
        continue;
      }
      if (text[pos] === ']') {
        pos++;
        return;
      }
      fail(`Expected ',' or ']', ${describe()}`);
    }
  }

  try {
    parseValue();
    skipWs();
    if (pos < text.length) fail(`Unexpected content after the JSON value: '${text[pos]}'`);
    return undefined;
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'offset' in err) return err as JsonErrorLocation;
    throw err;
  }
}
