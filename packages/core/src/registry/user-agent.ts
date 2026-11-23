// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0

/** Where a registry operator can find out what is sending these requests. */
export const PROJECT_URL = 'https://github.com/agivanttechnologies/SlopSquatShield';

let current = `slopsquatshield (+${PROJECT_URL})`;

/**
 * Sets the User-Agent every registry request sends, so registry operators can identify the tool
 * (their terms ask automated clients to). Called once at startup by each surface: the CLI with
 * `slopsquatshield`, the editor extension with `slopsquatshield-vscode`. It carries the product,
 * its version and the project URL — never anything about the user or their machine.
 */
export function setUserAgent(product: string, version: string): void {
  current = `${product}/${version} (+${PROJECT_URL})`;
}

export function getUserAgent(): string {
  return current;
}
