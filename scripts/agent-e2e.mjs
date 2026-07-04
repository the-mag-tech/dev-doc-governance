#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const AGENT_TIMEOUT_MS = 180_000;
const E2E_TMP_ROOT = process.env.AGENT_E2E_TMP_ROOT ??
  (existsSync('/private/tmp') ? '/private/tmp' : tmpdir());

function argValue(name, fallback = null) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function copyIntoBundle(bundleRoot, fromRel) {
  const target = join(bundleRoot, fromRel);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(REPO_ROOT, fromRel), target);
}

function makeBundle() {
  const bundleRoot = mkdtempSync(join(E2E_TMP_ROOT, 'dev-doc-governance-agent-e2e.'));
  copyIntoBundle(bundleRoot, 'bin/doc-governance.mjs');
  copyIntoBundle(bundleRoot, 'test/doc-governance.test.mjs');
  copyIntoBundle(bundleRoot, 'decision-registry.json');
  mkdirSync(join(bundleRoot, 'tmp'), { recursive: true });
  return bundleRoot;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...(options.env ?? {}),
    },
    timeout: options.timeout ?? AGENT_TIMEOUT_MS,
  });
}

function outputOf(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function testCommand(bundleRoot) {
  return `TMPDIR=${join(bundleRoot, 'tmp')} node --test ${join(bundleRoot, 'test/doc-governance.test.mjs')}`;
}

function promptFor(bundleRoot) {
  return [
    'You are in an isolated temporary test bundle.',
    'Run exactly this command and report the exit code plus final test summary:',
    testCommand(bundleRoot),
    'Do not read source files. Do not edit files.',
  ].join(' ');
}

function summaryPassed(result) {
  const output = outputOf(result);
  return result.status === 0 &&
    /tests\D+18/i.test(output) &&
    /pass\D+18/i.test(output) &&
    /fail\D+0/i.test(output);
}

function printResult(name, result) {
  const output = outputOf(result).trim();
  console.log(`\n== ${name} ==`);
  console.log(`status: ${result.status ?? 'null'}`);
  if (result.signal) console.log(`signal: ${result.signal}`);
  if (result.error) console.log(`error: ${result.error.message}`);
  if (output) console.log(output);
}

function resolveCodexBin() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const desktopBin = '/Applications/Codex.app/Contents/Resources/codex';
  if (existsSync(desktopBin)) return desktopBin;
  return 'codex';
}

function runLocal(bundleRoot) {
  return run(process.execPath, ['--test', join(bundleRoot, 'test/doc-governance.test.mjs')], {
    cwd: bundleRoot,
    env: { TMPDIR: join(bundleRoot, 'tmp') },
    timeout: 60_000,
  });
}

function runClaude(bundleRoot) {
  return run('claude', [
    '-p',
    '--bare',
    '--tools',
    'Bash',
    '--allowedTools',
    'Bash(node:*)',
    '--max-budget-usd',
    '0.30',
    '--output-format',
    'text',
    promptFor(bundleRoot),
  ], {
    cwd: bundleRoot,
    env: { TMPDIR: join(bundleRoot, 'tmp') },
  });
}

function runCodex(bundleRoot) {
  return run(resolveCodexBin(), [
    'exec',
    '--skip-git-repo-check',
    promptFor(bundleRoot),
    '-C',
    bundleRoot,
    '-s',
    'workspace-write',
    '-c',
    'model_reasoning_effort="medium"',
  ], {
    cwd: bundleRoot,
    env: { TMPDIR: join(bundleRoot, 'tmp') },
  });
}

function runCursor(bundleRoot) {
  const cursorBin = process.env.CURSOR_AGENT_BIN ?? 'cursor-agent';
  let result = run(cursorBin, [
    '-p',
    '-f',
    '--output-format',
    'text',
    promptFor(bundleRoot),
  ], {
    cwd: bundleRoot,
    env: { TMPDIR: join(bundleRoot, 'tmp') },
  });

  if (result.error?.code === 'ENOENT') {
    result = run('cursor', [
      'agent',
      '-p',
      '-f',
      '--output-format',
      'text',
      promptFor(bundleRoot),
    ], {
      cwd: bundleRoot,
      env: { TMPDIR: join(bundleRoot, 'tmp') },
    });
  }

  return result;
}

function main() {
  const bundleRoot = makeBundle();
  const localOnly = hasFlag('--local-only');
  const agents = argValue('--agents', '')
    .split(',')
    .map((agent) => agent.trim())
    .filter(Boolean);

  console.log(`Bundle: ${bundleRoot}`);

  const local = runLocal(bundleRoot);
  printResult('local bundle', local);
  if (local.status !== 0) process.exit(1);

  if (localOnly || agents.length === 0) {
    console.log('\nAgent E2E bundle is ready.');
    console.log(`Command under test: ${testCommand(bundleRoot)}`);
    return;
  }

  const runners = {
    claude: runClaude,
    codex: runCodex,
    cursor: runCursor,
  };
  let failed = false;

  for (const agent of agents) {
    const runner = runners[agent];
    if (!runner) {
      console.error(`Unknown agent: ${agent}`);
      failed = true;
      continue;
    }
    const result = runner(bundleRoot);
    printResult(agent, result);
    if (!summaryPassed(result)) failed = true;
  }

  if (failed) process.exit(1);
}

main();
