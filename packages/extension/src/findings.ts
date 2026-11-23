// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Ecosystem, SignalType } from '@slopsquatshield/core';
import type { FindingKind, Severity } from './severity.js';
import type { Range } from './text.js';

/** One thing to show in the editor: a diagnostic's worth of information, free of VS Code types. */
export interface Finding {
  fileName: string;
  identifier: string;
  ecosystem: Ecosystem | undefined;
  kind: FindingKind;
  severity: Severity;
  /** The verdict's own plain-English reason (NFR-6.1) — never a bare score. */
  message: string;
  range: Range;
  signals: SignalType[];
  /** For a name-similarity finding: the popular package this is suspiciously close to. */
  suggestion?: string;
  /** Whole lines holding the declaration, when it can be removed safely as whole lines. */
  removeLines?: { startLine: number; endLine: number };
}
