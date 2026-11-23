#!/usr/bin/env node
// Copyright 2026 Agivant Technologies Inc.
// SPDX-License-Identifier: Apache-2.0
// Measures the agent-hook adapters' end-to-end latency (NFR-2.2 / FR-13.1: warm < 300 ms) —
// process start to stdout, because hosts spawn a fresh process per tool call.
//
// Usage: node scripts/measure-hook-latency.mjs [--runs 30] [--cli packages/cli/dist/index.js]
// Uses an isolated HOME (so an isolated registry cache) and needs the real npm registry once,
// to warm the cache with a known package. Prints a table; exits 1 if a median is over budget.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const RUNS = Number(opt('--runs', '30'));
const CLI = resolve(opt('--cli', 'packages/cli/dist/index.js'));
const BUDGET_MS = 300;

const home = mkdtempSync(join(tmpdir(), 'ssg-latency-'));
const env = { ...process.env, HOME: home, USERPROFILE: home };
process.on('exit', () => rmSync(home, { recursive: true, force: true }));

// A project with a realistic manifest, for the manifest-driven scenario: a bare `npm install`
// names nothing, so the hook reads this package.json and checks every dependency in it.
const project = join(home, 'project');
mkdirSync(project);
writeFileSync(
  join(project, 'package.json'),
  JSON.stringify({
    name: 'latency-fixture',
    dependencies: Object.fromEntries(
      [
        'express',
        'left-pad',
        'lodash',
        'chalk',
        'debug',
        'ms',
        'semver',
        'uuid',
        'yargs',
        'minimist',
      ].map((n) => [n, '*']),
    ),
  }),
);

const claudeShape = (command) =>
  JSON.stringify({ cwd: project, tool_name: 'Bash', tool_input: { command } });
const antigravityShape = (command) =>
  JSON.stringify({
    toolCall: { name: 'run_command', args: { CommandLine: command, Cwd: project } },
  });
const hosts = [
  ['claude-code', claudeShape],
  ['cursor', claudeShape],
  ['codex', claudeShape],
  ['antigravity', antigravityShape],
];
const scenarios = [
  ['non-install (ls)', 'ls -la'],
  ['warm install (express)', 'npm install express'],
  ['warm bare install (10-dep manifest)', 'npm install'],
];

function once(host, payload) {
  const start = performance.now();
  const r = spawnSync(process.execPath, [CLI, 'hook', host], {
    input: payload,
    env,
    encoding: 'utf-8',
  });
  const ms = performance.now() - start;
  if (r.status !== 0) throw new Error(`hook ${host} exited ${r.status}: ${r.stderr}`);
  return ms;
}

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// Warm the cache once per host family (cold, network) so the timed runs are cache hits.
once('claude-code', claudeShape('npm install express'));
once('claude-code', claudeShape('npm install')); // and every dependency of the fixture manifest

const rows = [];
let over = false;
for (const [host, shape] of hosts) {
  for (const [label, command] of scenarios) {
    const payload = shape(command);
    once(host, payload); // discard: first run of this host/scenario pair (disk cache, JIT)
    const samples = Array.from({ length: RUNS }, () => once(host, payload)).sort((a, b) => a - b);
    const median = pct(samples, 50);
    if (median > BUDGET_MS) over = true;
    rows.push({
      host,
      scenario: label,
      'median ms': median.toFixed(0),
      'p95 ms': pct(samples, 95).toFixed(0),
      min: samples[0].toFixed(0),
    });
  }
}
console.table(rows);
console.log(
  `budget: warm < ${BUDGET_MS} ms · runs per cell: ${RUNS} · node ${process.version} · ${process.platform}`,
);
console.log(over ? 'OVER BUDGET' : 'within budget');
process.exit(over ? 1 : 0);
