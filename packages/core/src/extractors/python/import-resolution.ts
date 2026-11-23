// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Curated import-name -> distribution-name fallback (FR-2.2), for the cases most likely
 * to trip up a hallucination check when no live Python env is available: the installed
 * package name differs from the name you `import`.
 */
export const FALLBACK_IMPORT_TABLE: Record<string, string> = {
  cv2: 'opencv-python',
  PIL: 'Pillow',
  yaml: 'PyYAML',
  sklearn: 'scikit-learn',
  bs4: 'beautifulsoup4',
  dotenv: 'python-dotenv',
  jwt: 'PyJWT',
  dateutil: 'python-dateutil',
  Crypto: 'pycryptodome',
  OpenSSL: 'pyOpenSSL',
  docx: 'python-docx',
  pptx: 'python-pptx',
  fitz: 'PyMuPDF',
  markdown: 'Markdown',
  serial: 'pyserial',
  usb: 'pyusb',
  win32api: 'pywin32',
  win32com: 'pywin32',
  win32con: 'pywin32',
  attr: 'attrs',
  attrs: 'attrs',
  zmq: 'pyzmq',
  nacl: 'PyNaCl',
  Xlib: 'python-xlib',
  gi: 'PyGObject',
  cairo: 'pycairo',
  MySQLdb: 'mysqlclient',
  psycopg2: 'psycopg2-binary',
  telebot: 'pyTelegramBotAPI',
  discord: 'discord.py',
  flask_sqlalchemy: 'Flask-SQLAlchemy',
  flask_cors: 'Flask-Cors',
  jose: 'python-jose',
  multipart: 'python-multipart',
  slugify: 'python-slugify',
  magic: 'python-magic',
} as const;

export type PythonImportResolutionSource = 'env' | 'fallback' | 'unresolved';

export interface PythonImportResolution {
  importName: string;
  distribution?: string;
  resolvedVia: PythonImportResolutionSource;
}

/**
 * Resolves a Python import name to its installed distribution name (FR-2). The active
 * env's mapping — from `importlib.metadata.packages_distributions()` (FR-2.1) — wins
 * when it names this import; otherwise the curated fallback table (FR-2.2) is tried.
 * An import neither source recognizes comes back `resolvedVia: 'unresolved'` rather than
 * a guess — per FR-2.3, that alone is never a finding, only ever a soft-warn signal a
 * caller may surface; it must never by itself escalate to BLOCK.
 */
export function resolvePythonImport(
  importName: string,
  envDistributions: Record<string, string[]> = {},
): PythonImportResolution {
  const envMatch = envDistributions[importName];
  if (envMatch && envMatch.length > 0) {
    return { importName, distribution: envMatch[0], resolvedVia: 'env' };
  }

  const fallback = FALLBACK_IMPORT_TABLE[importName];
  if (fallback) {
    return { importName, distribution: fallback, resolvedVia: 'fallback' };
  }

  return { importName, resolvedVia: 'unresolved' };
}

/**
 * Queries the active Python environment's import->distribution mapping via
 * `importlib.metadata.packages_distributions()` (FR-2.1, Python 3.10+). No interpreter
 * on PATH, or one whose stdlib predates that function, is infrastructure absence rather
 * than a finding (NFR-3.1) — callers get an empty mapping back and every import falls
 * through to {@link resolvePythonImport}'s fallback/unresolved tiers instead of throwing.
 */
export async function getActiveEnvPackageDistributions(
  pythonExecutable = 'python3',
): Promise<Record<string, string[]>> {
  try {
    const { stdout } = await execFileAsync(pythonExecutable, [
      '-c',
      'import importlib.metadata, json; print(json.dumps(importlib.metadata.packages_distributions()))',
    ]);
    return JSON.parse(stdout) as Record<string, string[]>;
  } catch {
    return {};
  }
}
