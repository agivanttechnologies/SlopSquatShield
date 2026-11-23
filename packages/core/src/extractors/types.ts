// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
export type Ecosystem = 'npm' | 'pypi' | 'maven';

export interface DependencyConflict {
  fields: string[];
  specifiers: string[];
}

export interface ExtractedDependency {
  name: string;
  ecosystem: Ecosystem;
  specifier?: string;
  extras?: string[];
  source: string;
  conflict?: DependencyConflict;
  /**
   * The name the dependency is declared under, when that differs from the package actually
   * installed: npm's `alias@npm:real-package` (`name` is then `real-package`, the one checked).
   */
  alias?: string;
}
