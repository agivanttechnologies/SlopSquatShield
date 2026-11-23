// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { proxyFetch } from '../../src/registry/proxy-fetch.js';
import { getUserAgent } from '../../src/registry/user-agent.js';

// Issue #34: behind a proxy, a gzip-encoded registry answer must still decode. These run a real
// CONNECT proxy and a gzip-serving target on 127.0.0.1, so nothing leaves the machine. (MSW is not
// used here: it does not intercept undici's own fetch, which is the code path under test.)
const BODY = { downloads: 4242, package: 'probe' };
const gzipped = zlib.gzipSync(JSON.stringify(BODY));

let target: http.Server;
let proxy: http.Server;
let tunnels = 0;
let viaProxy: boolean | undefined;
let seenUserAgent: string | undefined;
/** Local ports of the proxy's upstream sockets: a request arriving from one came through a tunnel. */
const tunnelPorts = new Set<number>();
const sockets = new Set<net.Socket>();

function port(server: http.Server): number {
  return (server.address() as AddressInfo).port;
}

beforeAll(async () => {
  target = http.createServer((req, res) => {
    seenUserAgent = req.headers['user-agent'];
    viaProxy = tunnelPorts.has(req.socket.remotePort ?? -1);
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': gzipped.length,
    });
    res.end(gzipped);
  });
  proxy = http.createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  proxy.on('connect', (req, client: net.Socket, head) => {
    tunnels++;
    const [host, p] = (req.url ?? '').split(':');
    const upstream = net.connect(Number(p), host, () => {
      tunnelPorts.add(upstream.localPort ?? -1);
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    for (const s of [client, upstream]) {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
      s.on('error', () => s.destroy());
    }
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
});

afterEach(() => {
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY']) delete process.env[name];
  tunnels = 0;
  viaProxy = undefined;
  seenUserAgent = undefined;
});

afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise<void>((r) => target.close(() => r()));
  await new Promise<void>((r) => proxy.close(() => r()));
});

describe('proxyFetch behind a proxy (issue #34)', () => {
  it('decodes a gzip body that came through the proxy, and sends the User-Agent', async () => {
    process.env.HTTPS_PROXY = `http://127.0.0.1:${port(proxy)}`;
    const res = await proxyFetch(`http://127.0.0.1:${port(target)}/downloads`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(BODY);
    expect(tunnels).toBe(1);
    expect(viaProxy).toBe(true);
    expect(seenUserAgent).toBe(getUserAgent());
  });

  it('also honours HTTP_PROXY', async () => {
    process.env.HTTP_PROXY = `http://127.0.0.1:${port(proxy)}`;
    const res = await proxyFetch(`http://127.0.0.1:${port(target)}/downloads`);
    expect(await res.json()).toEqual(BODY);
    // The agent may reuse the kept-alive tunnel from the test above, so check the route, not a count.
    expect(viaProxy).toBe(true);
  });

  it('goes direct, through the built-in fetch, when no proxy is set', async () => {
    const res = await proxyFetch(`http://127.0.0.1:${port(target)}/downloads`);
    expect(await res.json()).toEqual(BODY);
    expect(tunnels).toBe(0);
    expect(viaProxy).toBe(false);
  });
});
