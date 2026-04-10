#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const START_MARKER = '<!-- INDEX:START -->';
const END_MARKER = '<!-- INDEX:END -->';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const BASE_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.pnpm-store',
]);

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function commandFromArgs() {
  const cmd = process.argv[2];
  if (!cmd || cmd.startsWith('-')) return 'run';
  return cmd;
}

function walkFiles(root, predicate, options = {}) {
  const includeArchive = options.includeArchive === true;
  const skipDirs = new Set(BASE_SKIP_DIRS);
  if (!includeArchive) skipDirs.add('.archive');

  const out = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(entry.name, fullPath)) out.push(fullPath);
    }
  }
  return out;
}

function ensureMarkers(readmePath) {
  if (!existsSync(readmePath)) throw new Error(`README not found: ${readmePath}`);
  const content = readFileSync(readmePath, 'utf-8');
  if (!content.includes(START_MARKER) || !content.includes(END_MARKER)) {
    throw new Error(`Index markers are missing in ${readmePath}`);
  }
}

function injectIndex(readmePath, table) {
  ensureMarkers(readmePath);
  const content = readFileSync(readmePath, 'utf-8');
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  const before = content.slice(0, start + START_MARKER.length);
  const after = content.slice(end);
  writeFileSync(readmePath, `${before}\n${table}\n${after}`, 'utf-8');
}

/** ADR companion files: not indexed as top-level ADRs and skip metadata checks. */
function isAdrSidecarFile(name) {
  return name.endsWith('.discussion.md') || name.endsWith('.exploration.md');
}

function parseAdr(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const name = basename(filePath);
  const numMatch = name.match(/^(\d+)-/);
  if (!numMatch || isAdrSidecarFile(name)) return null;

  return {
    num: numMatch[1],
    title: (content.match(/^#\s+ADR-\d+:\s*(.+)$/m)?.[1] ?? name).trim(),
    status: (extractAdrStatus(content) ?? 'unknown').trim(),
    date: (extractAdrDate(content) ?? '—').trim(),
    file: name,
  };
}

function parsePit(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const name = basename(filePath);
  const idMatch = name.match(/^(PIT-\d+)/);
  if (!idMatch) return null;
  const field = (key) => (content.match(new RegExp(`^\\*\\*${key}:\\*\\*\\s*(.+)$`, 'mi'))?.[1] ?? '—').trim();
  return {
    id: idMatch[1],
    title: (content.match(/^#\s+PIT-\d+:\s*(.+)$/m)?.[1] ?? name).trim(),
    area: field('Area'),
    severity: field('Severity'),
    status: field('Status'),
    file: name,
  };
}

function discoverDocRoots(root, options) {
  const adrReadmes = walkFiles(
    root,
    (name, fullPath) =>
      name === 'README.md' && fullPath.endsWith('/doc/adr/README.md'),
    options,
  );
  const pitReadmes = walkFiles(
    root,
    (name, fullPath) =>
      name === 'README.md' && fullPath.endsWith('/doc/pitfall/README.md'),
    options,
  );

  const roots = new Set();
  for (const p of adrReadmes) roots.add(dirname(dirname(p)));
  for (const p of pitReadmes) roots.add(dirname(dirname(p)));
  return [...roots].sort((a, b) => a.localeCompare(b));
}

function adrTable(entries) {
  const rows = [...entries]
    .sort((a, b) => a.num.localeCompare(b.num))
    .map((e) => `| ${e.num} | [${e.title}](${e.file}) | ${e.status} | ${e.date} |`);
  return ['| ADR | Title | Status | Date |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function pitTable(entries) {
  const rows = [...entries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => `| [${e.id}](${e.file}) | ${e.title} | ${e.area} | ${e.severity} | ${e.status} |`);
  return ['| ID | Title | Area | Severity | Status |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

function generateIndexes(root, options = {}) {
  const docRoots = discoverDocRoots(root, options);
  for (const docRoot of docRoots) {
    const adrDir = join(docRoot, 'adr');
    const pitDir = join(docRoot, 'pitfall');

    if (existsSync(adrDir) && existsSync(join(adrDir, 'README.md'))) {
      const adrEntries = readdirSync(adrDir)
        .filter((n) => /^\d{3}-.*\.md$/.test(n))
        .map((n) => parseAdr(join(adrDir, n)))
        .filter(Boolean);
      injectIndex(join(adrDir, 'README.md'), adrTable(adrEntries));
      console.log(`Updated ADR index (${adrEntries.length} entries) in ${rel(root, docRoot)}`);
    }

    if (existsSync(pitDir) && existsSync(join(pitDir, 'README.md'))) {
      const pitEntries = readdirSync(pitDir)
        .filter((n) => /^PIT-\d+.*\.md$/.test(n))
        .map((n) => parsePit(join(pitDir, n)))
        .filter(Boolean);
      injectIndex(join(pitDir, 'README.md'), pitTable(pitEntries));
      console.log(`Updated pitfall index (${pitEntries.length} entries) in ${rel(root, docRoot)}`);
    }
  }
}

function extractAdrStatus(text) {
  const line = text.match(/^Status:\s*(.+)$/im)?.[1]?.trim();
  if (line) return line;

  const section = text.match(/^##\s+Status\s*\n+([^\n#][^\n]*)/im)?.[1]?.trim();
  if (section) return section;

  return null;
}

function extractAdrDate(text) {
  const line = text.match(/^Date:\s*(\d{4}-\d{2}-\d{2})$/im)?.[1]?.trim();
  if (line) return line;
  return null;
}

function normalizeStatus(status) {
  return status.toLowerCase().trim();
}

function requiresDiscussion(status) {
  const normalized = normalizeStatus(status);
  if (normalized.startsWith('proposed')) return true;
  if (normalized.startsWith('draft')) return true;
  return false;
}

function rel(root, fullPath) {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
  return fullPath.startsWith(normalizedRoot) ? fullPath.slice(normalizedRoot.length) : fullPath;
}

function isLocalLink(link) {
  if (!link) return false;
  if (link.startsWith('http://') || link.startsWith('https://')) return false;
  if (link.startsWith('mailto:')) return false;
  if (link.startsWith('#')) return false;
  return true;
}

function checkLocalMarkdownLinks(filePath, errors, root) {
  const source = readFileSync(filePath, 'utf-8');
  // Ignore fenced code blocks for link validation.
  const noFencedCode = source.replace(/```[\s\S]*?```/g, '');
  // Ignore inline code spans; examples often contain template links.
  const text = noFencedCode.replace(/`[^`]*`/g, '');
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of text.matchAll(regex)) {
    const rawLink = match[1].trim();
    const link = rawLink.split('#')[0].trim();
    // Template placeholders are intentionally unresolved.
    if (link.includes('{') || link.includes('}')) continue;
    if (!isLocalLink(link)) continue;
    const target = resolve(dirname(filePath), link);
    if (!existsSync(target)) {
      errors.push(`${rel(root, filePath)}: broken local link -> ${rawLink}`);
    }
  }
}

function discoverPackageRoots(root, options) {
  const roots = [];
  const candidates = ['apps', 'packages', 'services', 'libs'];

  for (const dirName of candidates) {
    const top = join(root, dirName);
    if (!existsSync(top)) continue;
    for (const entry of readdirSync(top, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgRoot = join(top, entry.name);
      if (existsSync(join(pkgRoot, 'AGENTS.md'))) {
        roots.push(pkgRoot);
      }
    }
  }

  // Also include nested AGENTS.md not covered by top-level package dirs.
  const allAgentFiles = walkFiles(root, (name) => name === 'AGENTS.md', options)
    .map((p) => dirname(p))
    .filter((p) => p !== root);
  for (const p of allAgentFiles) {
    if (!roots.includes(p)) roots.push(p);
  }

  roots.sort((a, b) => a.localeCompare(b));
  return roots;
}

function checkProjectLevelDocs(root, errors) {
  const projectAgents = join(root, 'AGENTS.md');
  const projectClaude = join(root, 'CLAUDE.md');

  if (existsSync(projectAgents)) {
    checkLocalMarkdownLinks(projectAgents, errors, root);
  } else {
    errors.push('AGENTS.md: missing project-level AGENTS.md');
  }

  if (existsSync(projectClaude)) {
    checkLocalMarkdownLinks(projectClaude, errors, root);
  } else {
    // CLAUDE is optional in some repos; keep as informational warning through stdout.
    console.log('Info: project-level CLAUDE.md not found');
  }
}

function checkPackageLevelDocs(root, errors, options) {
  const packageRoots = discoverPackageRoots(root, options);
  for (const packageRoot of packageRoots) {
    const agentsPath = join(packageRoot, 'AGENTS.md');
    if (!existsSync(agentsPath)) continue;
    checkLocalMarkdownLinks(agentsPath, errors, root);
  }
  return packageRoots.length;
}

function checkSkillDocs(root, errors, options) {
  const skillFiles = walkFiles(root, (name) => name === 'SKILL.md', options);
  for (const file of skillFiles) {
    const text = readFileSync(file, 'utf-8');
    if (!/^#\s+.+$/m.test(text)) {
      errors.push(`${rel(root, file)}: missing top-level heading`);
    }
    checkLocalMarkdownLinks(file, errors, root);
  }
  return skillFiles.length;
}

function checkGovernance(root, options = {}) {
  const errors = [];
  const docRoots = discoverDocRoots(root, options);

  for (const docRoot of docRoots) {
    const adrDir = join(docRoot, 'adr');
    const pitDir = join(docRoot, 'pitfall');

    if (existsSync(join(adrDir, 'README.md'))) {
      try {
        ensureMarkers(join(adrDir, 'README.md'));
      } catch (e) {
        errors.push(e.message);
      }
    }

    if (existsSync(join(pitDir, 'README.md'))) {
      try {
        ensureMarkers(join(pitDir, 'README.md'));
      } catch (e) {
        errors.push(e.message);
      }
    }

    if (existsSync(adrDir)) {
      const adrFiles = readdirSync(adrDir).filter(
        (n) => /^\d{3}-.*\.md$/.test(n) && !isAdrSidecarFile(n),
      );
      for (const file of adrFiles) {
        const full = join(adrDir, file);
        const text = readFileSync(full, 'utf-8');
        if (!/^#\s+ADR-\d+:\s+.+$/m.test(text)) {
          errors.push(`${rel(root, full)}: missing ADR title`);
        }
        const status = extractAdrStatus(text);
        if (!status) {
          errors.push(`${rel(root, full)}: missing Status`);
        }
        const date = extractAdrDate(text);
        if (!date) {
          errors.push(`${rel(root, full)}: missing Date`);
        }
        const discussion = text.match(
          /^>\s*Discussion:\s*\[discussion log\]\(([^)]+\.discussion\.md)\)\s*$/mi,
        );
        if (status && requiresDiscussion(status) && !discussion) {
          errors.push(`${rel(root, full)}: missing discussion link`);
        } else if (discussion && !existsSync(join(adrDir, discussion[1]))) {
          errors.push(`${rel(root, full)}: linked discussion not found (${discussion[1]})`);
        }
      }
    }
  }

  checkProjectLevelDocs(root, errors);
  const packageCount = checkPackageLevelDocs(root, errors, options);
  const skillCount = checkSkillDocs(root, errors, options);
  const decisionRefs = checkDecisionRegistryUsage(root, errors, options);

  if (errors.length > 0) {
    console.error('\nDocumentation governance checks failed:\n');
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  console.log('Documentation governance checks passed');
  console.log(`Checked doc roots: ${docRoots.length}`);
  console.log(`Checked package-level AGENTS roots: ${packageCount}`);
  console.log(`Checked SKILL files: ${skillCount}`);
  console.log(`Checked decision references: ${decisionRefs}`);
}

function parseJsonFile(filePath, errors, root, label = 'JSON') {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    errors.push(`${label} parse failed (${rel(root, filePath)}): ${err.message}`);
    return null;
  }
}

function normalizeDecisionId(id) {
  return String(id || '').trim().toLowerCase();
}

function resolveRegistryPath(root, options = {}) {
  if (options.decisionRegistryPath) return resolve(root, options.decisionRegistryPath);

  const localPath = join(root, 'decision-registry.json');
  if (existsSync(localPath)) return localPath;

  const bundledPath = join(PACKAGE_ROOT, 'decision-registry.json');
  if (existsSync(bundledPath)) return bundledPath;

  return null;
}

function loadDecisionRegistry(root, errors, options = {}) {
  const registryPath = resolveRegistryPath(root, options);
  if (!registryPath || !existsSync(registryPath)) return null;

  const registry = parseJsonFile(registryPath, errors, root, 'decision-registry.json');
  if (!registry) return null;

  if (typeof registry.version !== 'number') {
    errors.push(`${rel(root, registryPath)}: missing numeric "version"`);
  }
  if (!Array.isArray(registry.decisions)) {
    errors.push(`${rel(root, registryPath)}: missing "decisions" array`);
    return null;
  }

  const ids = new Set();
  const canonicalUrlToId = new Map();
  const byId = new Map();

  for (const entry of registry.decisions) {
    const id = normalizeDecisionId(entry.id);
    if (!id) {
      errors.push(`${rel(root, registryPath)}: decision entry has empty id`);
      continue;
    }
    if (ids.has(id)) {
      errors.push(`${rel(root, registryPath)}: duplicate decision id "${id}"`);
      continue;
    }
    ids.add(id);
    byId.set(id, entry);

    if (entry.canonicalUrl && typeof entry.canonicalUrl === 'string') {
      canonicalUrlToId.set(entry.canonicalUrl.trim(), id);
    }
  }

  return { registryPath, registry, byId, canonicalUrlToId };
}

function checkDecisionRegistryUsage(root, errors, options = {}) {
  const loaded = loadDecisionRegistry(root, errors, options);
  if (!loaded) return 0;

  const {
    registryPath,
    registry,
    byId,
    canonicalUrlToId,
  } = loaded;

  const rules = {
    allowRawGithubAdrLinks:
      registry?.rules?.allowRawGithubAdrLinks !== false ? true : false,
    requireDecisionIdForCrossRepoReferences:
      registry?.rules?.requireDecisionIdForCrossRepoReferences === true,
  };

  const mdFiles = walkFiles(root, (name) => name.endsWith('.md'), options)
    .filter((p) => !p.includes('/node_modules/'));

  let totalRefs = 0;

  for (const filePath of mdFiles) {
    const text = readFileSync(filePath, 'utf-8');

    // Prefer stable IDs in docs: @decision skillet:003
    const decisionMatches = [...text.matchAll(/@decision\s+([a-z0-9._-]+:\d{3})/gi)];
    const idsInFile = new Set();
    for (const match of decisionMatches) {
      const id = normalizeDecisionId(match[1]);
      idsInFile.add(id);
      totalRefs += 1;
      if (!byId.has(id)) {
        errors.push(
          `${rel(root, filePath)}: unknown decision reference "@decision ${id}" (see ${rel(root, registryPath)})`,
        );
      }
    }

    // Raw cross-repo ADR links are fragile; optionally enforce registry IDs.
    const adrLinks = [...text.matchAll(/https:\/\/github\.com\/[^\s)]+\/doc[s]?\/adr\/\d{3}-[^\s)#]+\.md/gi)]
      .map((m) => m[0]);

    if (adrLinks.length === 0) continue;

    if (!rules.allowRawGithubAdrLinks) {
      for (const url of adrLinks) {
        const knownId = canonicalUrlToId.get(url);
        const hint = knownId ? ` Use "@decision ${knownId}" instead.` : ' Use "@decision <repo>:<NNN>" instead.';
        errors.push(`${rel(root, filePath)}: raw GitHub ADR link is forbidden: ${url}.${hint}`);
      }
    }

    if (rules.requireDecisionIdForCrossRepoReferences && idsInFile.size === 0) {
      errors.push(
        `${rel(root, filePath)}: cross-repo ADR link found but no @decision id present`,
      );
    }
  }

  return totalRefs;
}

function main() {
  const root = resolve(parseArg('--root', '.'));
  const options = {
    includeArchive: hasFlag('--include-archive'),
    decisionRegistryPath: parseArg('--decision-registry', null),
  };
  const cmd = commandFromArgs();

  if (cmd === 'gen-index') {
    generateIndexes(root, options);
    return;
  }
  if (cmd === 'check') {
    checkGovernance(root, options);
    return;
  }
  if (cmd === 'check-registry') {
    const errors = [];
    const refs = checkDecisionRegistryUsage(root, errors, options);
    if (errors.length > 0) {
      console.error('\nDecision registry checks failed:\n');
      for (const e of errors) console.error(`- ${e}`);
      process.exit(1);
    }
    console.log('Decision registry checks passed');
    console.log(`Checked decision references: ${refs}`);
    return;
  }
  if (cmd === 'run') {
    generateIndexes(root, options);
    checkGovernance(root, options);
    return;
  }

  console.error(
    'Usage: doc-governance [gen-index|check|check-registry|run] [--root <path>] [--include-archive] [--decision-registry <path>]',
  );
  process.exit(1);
}

main();
