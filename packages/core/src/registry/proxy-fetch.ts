// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { getUserAgent } from './user-agent.js';

function proxyUrlFromEnv(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    undefined
  );
}

/**
 * Wraps the global `fetch` so outbound calls honor HTTPS_PROXY/HTTP_PROXY, which Node's
 * native fetch (undici) ignores by default. The tech-stack decision named `https-proxy-agent`
 * for this, but that library only implements the classic `http.Agent` interface — it can't
 * be passed as native fetch's `dispatcher`. undici's own `ProxyAgent` does implement that
 * interface, so it's used here instead; this is the same kind of build-time correction as
 * FR-3.1's deps.dev fact count. `npm-registry-fetch` is unaffected — it
 * already honours the proxy environment variables itself (it does not read `.npmrc`).
 *
 * Behind a proxy the request goes through undici's **own** `fetch`, not Node's built-in one: a
 * `ProxyAgent` handed to a built-in fetch from a different undici version (Node 22 ships undici 6,
 * we bundle 7) can return a 200 whose body is still compressed while `content-encoding` is already
 * stripped, so `res.json()` throws and the signal is silently lost (issue #34). Pairing the agent
 * with the fetch from the same package rules that out on every Node version.
 *
 * Every request also carries the tool's User-Agent (see `user-agent.ts`) unless the caller set one.
 */
const agents = new Map<string, ProxyAgent>();

/** The longest `Retry-After` we wait out before one retry; anything longer is "couldn't check". */
export const MAX_RETRY_AFTER_MS = 2000;

/**
 * Milliseconds a `Retry-After` header asks for (delta-seconds or an HTTP date), or `undefined`
 * when it is missing or unreadable.
 */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // An HTTP date always has a day or month name; without one, Date.parse reads '-1' as a year.
  if (!/[a-z]/i.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

const send: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', getUserAgent());
  const proxyUrl = proxyUrlFromEnv();
  if (!proxyUrl) return fetch(input, { ...init, headers });
  let agent = agents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, agent);
  }
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    {
      ...init,
      headers,
      dispatcher: agent,
    } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>;
};

/**
 * Rate limits: none of the services we call publishes a number; all of them answer 429 when a
 * client sends too much. On a 429 whose `Retry-After` is at most {@link MAX_RETRY_AFTER_MS}, we
 * wait and retry once. Otherwise (no header, or a longer wait) the 429 goes back to the caller,
 * which treats it as "couldn't check" (fail open, NFR-3.1) — never a finding, and never a stall
 * in an agent hook. Every request here is a GET without a body, so a retry is always safe.
 */
export const proxyFetch: typeof fetch = async (input, init) => {
  const res = await send(input, init);
  if (res.status !== 429) return res;
  const wait = retryAfterMs(res.headers.get('retry-after'));
  if (wait === undefined || wait > MAX_RETRY_AFTER_MS) return res;
  await res.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, wait));
  return send(input, init);
};
