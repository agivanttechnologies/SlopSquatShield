// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, vi } from 'vitest';

// Every package mocks the registries with MSW and listens with `onUnhandledRequest: 'error'`. But the
// code under test fails open by design — a request that errors is swallowed as "registry
// unreachable", or a soft-omitted signal — so a mock that never matched (a URL-encoded scope, a
// renamed endpoint) used to leave the test *passing* while exercising a different path than it
// claims. This records each unhandled request and fails the test that made it.
const unhandled: string[] = [];

// Behind a proxy, `proxyFetch` uses undici's own fetch (issue #34), which MSW does not intercept. A
// developer's or CI runner's proxy variables must therefore never reach the code under test, or a
// test could make a real request. Tests that exercise the proxy path set these themselves.
for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])
  delete process.env[name];

vi.mock('msw/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('msw/node')>();
  return {
    ...actual,
    setupServer: (...handlers: Parameters<typeof actual.setupServer>) => {
      const server = actual.setupServer(...handlers);
      server.events.on('request:unhandled', ({ request }) => {
        unhandled.push(`${request.method} ${request.url}`);
      });
      return server;
    },
  };
});

afterEach(() => {
  const missed = unhandled.splice(0);
  if (missed.length > 0) {
    throw new Error(
      `This test made request(s) no mock handler matched (the code under test fails open, so it would have passed anyway):\n  ${missed.join('\n  ')}`,
    );
  }
});
