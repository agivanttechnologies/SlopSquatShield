// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Ecosystem } from '../extractors/types.js';

/** "does not exist on …": the registry as a person would say it — `PyPI`, not the id `pypi`. */
export function existsOn(ecosystem: Ecosystem): string {
  switch (ecosystem) {
    case 'npm':
      return 'the npm registry';
    case 'pypi':
      return 'PyPI';
    case 'maven':
      return 'Maven Central';
  }
}

/** "resolves on the public …". */
export function publicRegistry(ecosystem: Ecosystem): string {
  switch (ecosystem) {
    case 'npm':
      return 'npm registry';
    case 'pypi':
      return 'PyPI index';
    case 'maven':
      return 'Maven Central repository';
  }
}

/** `1134133` -> `1,134,133`: raw digit runs are hard to read at a glance. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
