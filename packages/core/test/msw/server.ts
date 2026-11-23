// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { setupServer } from 'msw/node';

/** Shared MSW server for mocking deps.dev/npm/PyPI/Maven Central HTTP calls in tests. */
export const server = setupServer();
