import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/doc-governance.mjs', import.meta.url));
const AGENT_PROFILES = [
  {
    name: 'codex-non-interactive',
    env: {
      CODEX_SANDBOX: 'read-only',
      CODEX_NONINTERACTIVE: '1',
      CI: '1',
      TERM: 'dumb',
    },
  },
  {
    name: 'cursor-agent-print',
    env: {
      CURSOR_AGENT: '1',
      CURSOR_AGENT_PRINT: '1',
      CI: '1',
      TERM: 'dumb',
    },
  },
  {
    name: 'claude-code-print',
    env: {
      CLAUDECODE: '1',
      CLAUDE_CODE_NON_INTERACTIVE: '1',
      CI: '1',
      TERM: 'dumb',
    },
  },
];

function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'doc-governance-test-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function writeManifest(root, content) {
  writeFile(join(root, 'doc-governance.topology.yaml'), content);
}

function runCli(root, args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args, '--root', root], {
    encoding: 'utf-8',
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    input: options.input ?? '',
  });
}

function expectTopologyFailure(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Doc topology checks failed/);
  assert.match(result.stderr, pattern);
}

function expectIndexFailure(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Generated index checks failed/);
  assert.match(result.stderr, pattern);
}

function writePassingGovernanceRepo(root) {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    root_files:
      allow:
        - README.md
    directories:
      adr:
        required: true
        readme: README.md
        index: generated
      research:
        required: false
        readme: README.md
`);
  writeFile(join(root, 'AGENTS.md'), '# Agent Notes\n\nSee [docs](doc/README.md).\n');
  writeFile(join(root, 'doc/README.md'), '# Docs\n');
  writeFile(join(root, 'doc/adr/001-first.md'), [
    '# ADR-001: First',
    '',
    'Status: Accepted',
    'Date: 2026-01-01',
    '',
  ].join('\n'));
  writeFile(join(root, 'doc/adr/README.md'), [
    '# ADRs',
    '',
    '<!-- INDEX:START -->',
    '| ADR | Title | Status | Date |',
    '| --- | --- | --- | --- |',
    '| 001 | [First](001-first.md) | Accepted | 2026-01-01 |',
    '<!-- INDEX:END -->',
    '',
  ].join('\n'));
}

function snapshotFiles(root, paths) {
  return new Map(paths.map((path) => {
    const fullPath = join(root, path);
    return [path, {
      content: readFileSync(fullPath, 'utf-8'),
      mtimeMs: statSync(fullPath).mtimeMs,
    }];
  }));
}

function assertSnapshotUnchanged(root, snapshot) {
  for (const [path, before] of snapshot) {
    assert.equal(readFileSync(join(root, path), 'utf-8'), before.content, path);
    assert.equal(statSync(join(root, path)).mtimeMs, before.mtimeMs, path);
  }
}

test('check-topology allows configured root files', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    root_files:
      allow:
        - README.md
`);
  writeFile(join(root, 'doc/README.md'), '# Docs\n');

  const result = runCli(root, ['check-topology']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Doc topology checks passed/);
}));

test('non-interactive agent-like profiles can run all non-mutating checks', () => withRepo((root) => {
  writePassingGovernanceRepo(root);
  const snapshot = snapshotFiles(root, [
    'AGENTS.md',
    'doc-governance.topology.yaml',
    'doc/README.md',
    'doc/adr/README.md',
    'doc/adr/001-first.md',
  ]);

  for (const profile of AGENT_PROFILES) {
    for (const command of ['check-topology', 'check-index', 'check']) {
      const result = runCli(root, [command], {
        cwd: tmpdir(),
        env: profile.env,
        input: 'unexpected stdin that must be ignored\n',
      });
      assert.equal(
        result.status,
        0,
        `${profile.name} ${command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
  }

  assertSnapshotUnchanged(root, snapshot);
}));

test('check-topology fails undeclared root files', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    root_files:
      allow:
        - README.md
`);
  writeFile(join(root, 'doc/README.md'), '# Docs\n');
  writeFile(join(root, 'doc/NOTES.md'), '# Notes\n');

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /doc\/NOTES\.md: undeclared root file/);
}));

test('check-topology fails undeclared directories', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
`);
  mkdirSync(join(root, 'doc/random'), { recursive: true });

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /doc\/random: undeclared directory/);
}));

test('check-topology fails missing required directories', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    directories:
      adr:
        required: true
`);
  mkdirSync(join(root, 'doc'), { recursive: true });

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /doc\/adr: required directory is missing/);
}));

test('check-topology fails missing declared README files', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    directories:
      adr:
        required: true
        readme: README.md
`);
  mkdirSync(join(root, 'doc/adr'), { recursive: true });

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /doc\/adr\/README\.md: declared README is missing/);
}));

test('check-topology fails generated index directories without markers', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    directories:
      adr:
        required: true
        readme: README.md
        index: generated
`);
  writeFile(join(root, 'doc/adr/README.md'), '# ADRs\n');

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /doc\/adr\/README\.md: generated index markers are missing/);
}));

test('check-topology fails broken local links inside doc roots', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    directories:
      research:
        required: true
        readme: README.md
`);
  writeFile(join(root, 'doc/research/README.md'), '# Research\n\n[Missing](missing.md)\n');

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /doc\/research\/README\.md: broken local link -> missing\.md/);
}));

test('check-topology supports explicit JSON manifests', () => withRepo((root) => {
  writeFile(join(root, 'config/topology.json'), JSON.stringify({
    version: 1,
    doc_roots: [
      {
        path: 'doc',
        root_files: { allow: ['README.md'] },
        directories: {
          research: { required: false, readme: 'README.md' },
        },
      },
    ],
  }));
  writeFile(join(root, 'doc/README.md'), '# Docs\n');

  const result = runCli(root, ['check-topology', '--topology-manifest', 'config/topology.json']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Manifest: config\/topology\.json/);
}));

test('check-topology fails empty or malformed manifests clearly', () => withRepo((root) => {
  writeManifest(root, '');
  let result = runCli(root, ['check-topology']);
  expectTopologyFailure(result, /doc-governance\.topology\.yaml: expected a manifest object/);

  writeManifest(root, `
version: 1
  bad_indent: true
doc_roots: []
`);
  result = runCli(root, ['check-topology']);
  expectTopologyFailure(result, /topology manifest YAML parse failed/);
}));

test('check-topology validates manifest schema boundaries', () => withRepo((root) => {
  writeManifest(root, `
version: 2
doc_roots:
  - path: /tmp/docs
  - path: ../outside
  - path: doc
    root_files:
      allow: README.md
    directories:
      nested/path:
        required: true
      research:
        required: yes
        readme: nested/README.md
        index: manual
`);
  mkdirSync(join(root, 'doc'), { recursive: true });

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /expected "version: 1"/);
  assert.match(result.stderr, /expected a repo-relative path/);
  assert.match(result.stderr, /path escapes repository root/);
  assert.match(result.stderr, /root_files\.allow: expected an array of strings/);
  assert.match(result.stderr, /directories\.nested\/path: expected a direct directory name/);
  assert.match(result.stderr, /directories\.research\.required: expected true or false/);
  assert.match(result.stderr, /directories\.research\.readme: expected a direct README filename/);
  assert.match(result.stderr, /directories\.research\.index: expected "generated" when present/);
}));

test('check-topology fails invalid filesystem shapes', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: missing-doc
  - path: file-doc
  - path: doc
    directories:
      research:
        required: true
        readme: README.md
      validation:
        required: true
        readme: README.md
`);
  writeFile(join(root, 'file-doc'), 'not a directory\n');
  writeFile(join(root, 'doc/research'), 'not a directory\n');
  mkdirSync(join(root, 'doc/validation/README.md'), { recursive: true });

  const result = runCli(root, ['check-topology']);

  expectTopologyFailure(result, /missing-doc: configured doc_root does not exist/);
  assert.match(result.stderr, /file-doc: configured doc_root is not a directory/);
  assert.match(result.stderr, /doc\/research: declared topology directory is not a directory/);
  assert.match(result.stderr, /doc\/validation\/README\.md: declared README is not a file/);
}));

test('check-topology permits missing optional directories', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    directories:
      release:
        required: false
        readme: README.md
`);
  mkdirSync(join(root, 'doc'), { recursive: true });

  const result = runCli(root, ['check-topology']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
}));

test('check-topology defaults generated index README name', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    directories:
      adr:
        required: true
        index: generated
`);
  writeFile(join(root, 'doc/adr/README.md'), [
    '# ADRs',
    '',
    '<!-- INDEX:START -->',
    '<!-- INDEX:END -->',
    '',
  ].join('\n'));

  const result = runCli(root, ['check-topology']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
}));

test('check-topology skips archives by default and includes them on request', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
`);
  mkdirSync(join(root, 'doc/.archive/random'), { recursive: true });

  let result = runCli(root, ['check-topology']);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  result = runCli(root, ['check-topology', '--include-archive']);
  expectTopologyFailure(result, /doc\/\.archive: undeclared directory/);
}));

test('check-topology resolves local link variants used by markdown tools', () => withRepo((root) => {
  writeManifest(root, `
version: 1
doc_roots:
  - path: doc
    directories:
      research:
        required: true
        readme: README.md
`);
  writeFile(join(root, 'doc/research/target.md'), '# Target\n');
  writeFile(join(root, 'doc/research/file with space.md'), '# Space\n');
  writeFile(join(root, 'doc/research/README.md'), [
    '# Research',
    '',
    '[relative](target.md)',
    '[fragment](target.md#section)',
    '[query](target.md?plain=1)',
    '[encoded](file%20with%20space.md)',
    '[angle](<file with space.md>)',
    '[external](https://example.com/doc.md)',
    '[mailto](mailto:test@example.com)',
    '[anchor](#local)',
    '[template]({repo}/README.md)',
    '[reference]: target.md',
    '',
    '`[inline code](missing.md)`',
    '',
    '```',
    '[fenced code](missing.md)',
    '```',
    '',
  ].join('\n'));

  const result = runCli(root, ['check-topology']);

  assert.equal(result.status, 0, result.stdout + result.stderr);
}));

test('check-index fails missing markers without mutating files', () => withRepo((root) => {
  writeFile(join(root, 'doc/adr/README.md'), '# ADRs\n');
  writeFile(join(root, 'doc/adr/001-first.md'), [
    '# ADR-001: First',
    '',
    'Status: Accepted',
    'Date: 2026-01-01',
    '',
  ].join('\n'));
  const before = readFileSync(join(root, 'doc/adr/README.md'), 'utf-8');

  const result = runCli(root, ['check-index']);

  expectIndexFailure(result, /doc\/adr\/README\.md: generated index markers are missing/);
  assert.equal(readFileSync(join(root, 'doc/adr/README.md'), 'utf-8'), before);
}));

test('check-index detects stale generated indexes without writing files', () => withRepo((root) => {
  writeFile(join(root, 'doc/adr/README.md'), [
    '# ADRs',
    '',
    '<!-- INDEX:START -->',
    'stale',
    '<!-- INDEX:END -->',
    '',
  ].join('\n'));
  writeFile(join(root, 'doc/adr/001-first.md'), [
    '# ADR-001: First',
    '',
    'Status: Accepted',
    'Date: 2026-01-01',
    '',
  ].join('\n'));

  const stale = runCli(root, ['check-index']);
  assert.notEqual(stale.status, 0, stale.stdout + stale.stderr);
  assert.match(stale.stderr, /doc\/adr\/README\.md: generated index is stale/);
  assert.match(readFileSync(join(root, 'doc/adr/README.md'), 'utf-8'), /stale/);

  const generated = runCli(root, ['gen-index']);
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);

  const fresh = runCli(root, ['check-index']);
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
}));
