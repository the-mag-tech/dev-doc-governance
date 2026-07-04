#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const START_MARKER = '<!-- INDEX:START -->';
const END_MARKER = '<!-- INDEX:END -->';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const TOPOLOGY_MANIFEST_CANDIDATES = [
  'doc-governance.topology.json',
  'doc-governance.topology.yaml',
  'doc-governance.topology.yml',
  '.doc-governance/topology.json',
  '.doc-governance/topology.yaml',
  '.doc-governance/topology.yml',
];
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInsidePath(parent, child) {
  const relPath = relative(parent, child);
  return relPath === '' || (!relPath.startsWith('..') && !isAbsolute(relPath));
}

function stripYamlComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const prev = raw[i - 1];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
    if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(prev))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function yamlLines(text) {
  return text
    .split(/\r?\n/)
    .map((raw, idx) => {
      const withoutComment = stripYamlComment(raw).replace(/\s+$/, '');
      if (!withoutComment.trim()) return null;
      const indent = withoutComment.match(/^ */)[0].length;
      return {
        line: idx + 1,
        indent,
        text: withoutComment.trim(),
      };
    })
    .filter(Boolean);
}

function parseYamlScalar(value, line) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (value === '[]') return [];
  if (value === '{}') return {};
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value);
      } catch {
        throw new Error(`line ${line}: invalid quoted string`);
      }
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseYamlScalar(part.trim(), line));
  }
  return value;
}

function splitYamlKeyValue(text, line) {
  const idx = text.indexOf(':');
  if (idx <= 0) throw new Error(`line ${line}: expected "key: value"`);
  const key = text.slice(0, idx).trim();
  const value = text.slice(idx + 1).trim();
  if (!key) throw new Error(`line ${line}: empty mapping key`);
  return { key, value };
}

function parseYamlBlock(lines, index, indent) {
  if (index >= lines.length || lines[index].indent < indent) return { value: null, index };
  if (lines[index].indent !== indent) {
    throw new Error(`line ${lines[index].line}: unexpected indentation`);
  }
  if (lines[index].text.startsWith('- ')) {
    return parseYamlSequence(lines, index, indent);
  }
  return parseYamlMapping(lines, index, indent);
}

function parseYamlMapping(lines, index, indent) {
  const out = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new Error(`line ${line.line}: unexpected indentation`);
    if (line.text.startsWith('- ')) break;

    const { key, value } = splitYamlKeyValue(line.text, line.line);
    cursor += 1;
    if (value === '') {
      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseYamlBlock(lines, cursor, lines[cursor].indent);
        out[key] = parsed.value;
        cursor = parsed.index;
      } else {
        out[key] = null;
      }
    } else {
      out[key] = parseYamlScalar(value, line.line);
    }
  }

  return { value: out, index: cursor };
}

function parseYamlSequence(lines, index, indent) {
  const out = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new Error(`line ${line.line}: unexpected indentation`);
    if (!line.text.startsWith('- ')) break;

    const itemText = line.text.slice(2).trim();
    cursor += 1;

    if (itemText === '') {
      if (cursor >= lines.length || lines[cursor].indent <= indent) {
        out.push(null);
        continue;
      }
      const parsed = parseYamlBlock(lines, cursor, lines[cursor].indent);
      out.push(parsed.value);
      cursor = parsed.index;
      continue;
    }

    if (/^[^:]+:/.test(itemText)) {
      const { key, value } = splitYamlKeyValue(itemText, line.line);
      const item = {};
      if (value === '') {
        if (cursor < lines.length && lines[cursor].indent > indent) {
          const parsed = parseYamlBlock(lines, cursor, lines[cursor].indent);
          item[key] = parsed.value;
          cursor = parsed.index;
        } else {
          item[key] = null;
        }
      } else {
        item[key] = parseYamlScalar(value, line.line);
      }

      if (cursor < lines.length && lines[cursor].indent > indent) {
        const parsed = parseYamlMapping(lines, cursor, lines[cursor].indent);
        Object.assign(item, parsed.value);
        cursor = parsed.index;
      }

      out.push(item);
      continue;
    }

    out.push(parseYamlScalar(itemText, line.line));
  }

  return { value: out, index: cursor };
}

function parseYaml(text) {
  const lines = yamlLines(text);
  if (lines.length === 0) return null;
  const parsed = parseYamlBlock(lines, 0, lines[0].indent);
  if (parsed.index !== lines.length) {
    throw new Error(`line ${lines[parsed.index].line}: unexpected content`);
  }
  return parsed.value;
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

function isIgnoredTopologyEntry(name, options = {}) {
  if (BASE_SKIP_DIRS.has(name)) return true;
  if (name === '.archive' && options.includeArchive !== true) return true;
  return false;
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

function collectAdrEntries(adrDir) {
  return readdirSync(adrDir)
    .filter((n) => /^\d{3}-.*\.md$/.test(n))
    .map((n) => parseAdr(join(adrDir, n)))
    .filter(Boolean);
}

function collectPitEntries(pitDir) {
  return readdirSync(pitDir)
    .filter((n) => /^PIT-\d+.*\.md$/.test(n))
    .map((n) => parsePit(join(pitDir, n)))
    .filter(Boolean);
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
      const adrEntries = collectAdrEntries(adrDir);
      injectIndex(join(adrDir, 'README.md'), adrTable(adrEntries));
      console.log(`Updated ADR index (${adrEntries.length} entries) in ${rel(root, docRoot)}`);
    }

    if (existsSync(pitDir) && existsSync(join(pitDir, 'README.md'))) {
      const pitEntries = collectPitEntries(pitDir);
      injectIndex(join(pitDir, 'README.md'), pitTable(pitEntries));
      console.log(`Updated pitfall index (${pitEntries.length} entries) in ${rel(root, docRoot)}`);
    }
  }
}

function readIndexBlock(readmePath) {
  ensureMarkers(readmePath);
  const content = readFileSync(readmePath, 'utf-8');
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  return content.slice(start + START_MARKER.length, end).trim();
}

function checkGeneratedIndexFile(root, readmePath, expectedTable, errors) {
  try {
    const current = readIndexBlock(readmePath);
    if (current !== expectedTable.trim()) {
      errors.push(
        `${rel(root, readmePath)}: generated index is stale; run "doc-governance gen-index --root <repo>"`,
      );
    }
  } catch {
    errors.push(
      `${rel(root, readmePath)}: generated index markers are missing; add ${START_MARKER} and ${END_MARKER}`,
    );
  }
}

function checkGeneratedIndexes(root, errors, options = {}) {
  const docRoots = discoverDocRoots(root, options);
  let checked = 0;

  for (const docRoot of docRoots) {
    const adrDir = join(docRoot, 'adr');
    const pitDir = join(docRoot, 'pitfall');

    if (existsSync(adrDir) && existsSync(join(adrDir, 'README.md'))) {
      checkGeneratedIndexFile(root, join(adrDir, 'README.md'), adrTable(collectAdrEntries(adrDir)), errors);
      checked += 1;
    }

    if (existsSync(pitDir) && existsSync(join(pitDir, 'README.md'))) {
      checkGeneratedIndexFile(root, join(pitDir, 'README.md'), pitTable(collectPitEntries(pitDir)), errors);
      checked += 1;
    }
  }

  return checked;
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
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return false;
  if (link.startsWith('//')) return false;
  if (link.startsWith('#')) return false;
  return true;
}

function localLinkPath(rawLink) {
  let link = rawLink.trim();
  if (link.startsWith('<')) {
    const close = link.indexOf('>');
    if (close !== -1) link = link.slice(1, close);
  } else {
    link = link.split(/\s+/)[0];
  }
  link = link.split(/[?#]/)[0].trim();
  if (!link) return null;
  try {
    return decodeURIComponent(link);
  } catch {
    return link;
  }
}

function checkLocalMarkdownLinks(filePath, errors, root) {
  const source = readFileSync(filePath, 'utf-8');
  // Ignore fenced code blocks for link validation.
  const noFencedCode = source.replace(/```[\s\S]*?```/g, '');
  // Ignore inline code spans; examples often contain template links.
  const text = noFencedCode.replace(/`[^`]*`/g, '');
  const links = [
    ...[...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]),
    ...[...text.matchAll(/^[ \t]{0,3}\[[^\]]+\]:\s+(\S+)/gm)].map((match) => match[1]),
  ];
  for (const rawLink of links) {
    const link = localLinkPath(rawLink);
    if (!link) continue;
    // Template placeholders are intentionally unresolved.
    if (link.includes('{') || link.includes('}')) continue;
    if (!isLocalLink(link)) continue;
    const target = resolve(dirname(filePath), link);
    if (!existsSync(target)) {
      errors.push(`${rel(root, filePath)}: broken local link -> ${rawLink.trim()}`);
    }
  }
}

function parseYamlFile(filePath, errors, root, label = 'YAML') {
  try {
    return parseYaml(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    errors.push(`${label} parse failed (${rel(root, filePath)}): ${err.message}`);
    return null;
  }
}

function resolveTopologyManifestPath(root, options = {}) {
  if (options.topologyManifestPath) {
    return resolve(root, options.topologyManifestPath);
  }

  for (const candidate of TOPOLOGY_MANIFEST_CANDIDATES) {
    const manifestPath = join(root, candidate);
    if (existsSync(manifestPath)) return manifestPath;
  }

  return null;
}

function validateStringArray(value, errors, label) {
  if (!Array.isArray(value)) {
    errors.push(`${label}: expected an array of strings`);
    return [];
  }
  const out = [];
  value.forEach((entry, idx) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      errors.push(`${label}[${idx}]: expected a non-empty string`);
      return;
    }
    out.push(entry);
  });
  return out;
}

function validateTopologyManifest(manifest, manifestPath, root, errors) {
  const manifestLabel = rel(root, manifestPath);
  if (!isPlainObject(manifest)) {
    errors.push(`${manifestLabel}: expected a manifest object`);
    return [];
  }

  if (manifest.version !== 1) {
    errors.push(`${manifestLabel}: expected "version: 1"`);
  }

  if (!Array.isArray(manifest.doc_roots)) {
    errors.push(`${manifestLabel}: missing "doc_roots" array`);
    return [];
  }

  const docRoots = [];
  const seenPaths = new Set();

  manifest.doc_roots.forEach((entry, idx) => {
    const label = `${manifestLabel}: doc_roots[${idx}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label}: expected an object`);
      return;
    }

    if (typeof entry.path !== 'string' || entry.path.trim() === '') {
      errors.push(`${label}.path: expected a non-empty repo-relative path`);
      return;
    }
    if (isAbsolute(entry.path)) {
      errors.push(`${label}.path: expected a repo-relative path, got absolute path "${entry.path}"`);
      return;
    }

    const fullPath = resolve(root, entry.path);
    if (!isInsidePath(root, fullPath)) {
      errors.push(`${label}.path: path escapes repository root (${entry.path})`);
      return;
    }
    if (seenPaths.has(fullPath)) {
      errors.push(`${label}.path: duplicate doc_root path "${entry.path}"`);
      return;
    }
    seenPaths.add(fullPath);

    let rootFilesAllow = [];
    if (entry.root_files !== undefined) {
      if (!isPlainObject(entry.root_files)) {
        errors.push(`${label}.root_files: expected an object`);
      } else if (entry.root_files.allow !== undefined) {
        rootFilesAllow = validateStringArray(entry.root_files.allow, errors, `${label}.root_files.allow`);
      }
    }

    const directories = new Map();
    if (entry.directories !== undefined) {
      if (!isPlainObject(entry.directories)) {
        errors.push(`${label}.directories: expected an object`);
      } else {
        for (const [dirName, cfg] of Object.entries(entry.directories)) {
          const dirLabel = `${label}.directories.${dirName}`;
          if (
            !dirName ||
            dirName === '.' ||
            dirName === '..' ||
            dirName.includes('/') ||
            dirName.includes('\\')
          ) {
            errors.push(`${dirLabel}: expected a direct directory name`);
            continue;
          }
          if (!isPlainObject(cfg)) {
            errors.push(`${dirLabel}: expected an object`);
            continue;
          }
          if (cfg.required !== undefined && typeof cfg.required !== 'boolean') {
            errors.push(`${dirLabel}.required: expected true or false`);
          }
          if (cfg.readme !== undefined) {
            if (
              typeof cfg.readme !== 'string' ||
              cfg.readme.trim() === '' ||
              cfg.readme.includes('/') ||
              cfg.readme.includes('\\')
            ) {
              errors.push(`${dirLabel}.readme: expected a direct README filename`);
            }
          }
          if (cfg.index !== undefined && cfg.index !== 'generated') {
            errors.push(`${dirLabel}.index: expected "generated" when present`);
          }
          directories.set(dirName, {
            required: cfg.required === true,
            readme: typeof cfg.readme === 'string' && cfg.readme.trim() ? cfg.readme : null,
            index: cfg.index ?? null,
            kind: typeof cfg.kind === 'string' ? cfg.kind : null,
          });
        }
      }
    }

    docRoots.push({
      path: entry.path,
      fullPath,
      rootFilesAllow: new Set(rootFilesAllow),
      directories,
    });
  });

  return docRoots;
}

function loadTopologyManifest(root, errors, options = {}) {
  const manifestPath = resolveTopologyManifestPath(root, options);
  if (!manifestPath) return null;

  if (!isInsidePath(root, manifestPath)) {
    errors.push(`${manifestPath}: topology manifest must be inside repository root`);
    return null;
  }
  if (!existsSync(manifestPath)) {
    errors.push(`${rel(root, manifestPath)}: topology manifest not found`);
    return null;
  }

  const errorCountBeforeParse = errors.length;
  let manifest = null;
  if (/\.json$/i.test(manifestPath)) {
    manifest = parseJsonFile(manifestPath, errors, root, 'topology manifest JSON');
  } else if (/\.ya?ml$/i.test(manifestPath)) {
    manifest = parseYamlFile(manifestPath, errors, root, 'topology manifest YAML');
  } else {
    errors.push(`${rel(root, manifestPath)}: unsupported topology manifest extension`);
    return null;
  }
  if (manifest === null || manifest === undefined) {
    if (errors.length === errorCountBeforeParse) {
      errors.push(`${rel(root, manifestPath)}: expected a manifest object`);
      return { manifestPath, docRoots: [] };
    }
    return null;
  }

  return {
    manifestPath,
    docRoots: validateTopologyManifest(manifest, manifestPath, root, errors),
  };
}

function checkTopology(root, errors, options = {}) {
  const loaded = loadTopologyManifest(root, errors, options);
  if (!loaded) return null;

  let markdownFiles = 0;

  for (const docRoot of loaded.docRoots) {
    if (!existsSync(docRoot.fullPath)) {
      errors.push(
        `${rel(root, docRoot.fullPath)}: configured doc_root does not exist; create it or update the topology manifest`,
      );
      continue;
    }
    if (!statSync(docRoot.fullPath).isDirectory()) {
      errors.push(`${rel(root, docRoot.fullPath)}: configured doc_root is not a directory`);
      continue;
    }

    for (const entry of readdirSync(docRoot.fullPath, { withFileTypes: true })) {
      if (isIgnoredTopologyEntry(entry.name, options)) continue;
      const fullPath = join(docRoot.fullPath, entry.name);
      if (entry.isFile()) {
        if (!docRoot.rootFilesAllow.has(entry.name)) {
          errors.push(
            `${rel(root, fullPath)}: undeclared root file under doc_root "${docRoot.path}"; add it to root_files.allow or move it into a declared directory`,
          );
        }
        continue;
      }
      if (entry.isDirectory()) {
        if (!docRoot.directories.has(entry.name)) {
          errors.push(
            `${rel(root, fullPath)}: undeclared directory under doc_root "${docRoot.path}"; declare it under directories or move it`,
          );
        }
        continue;
      }
      errors.push(`${rel(root, fullPath)}: unsupported entry type under doc_root "${docRoot.path}"`);
    }

    for (const [dirName, cfg] of docRoot.directories) {
      const dirPath = join(docRoot.fullPath, dirName);
      const dirExists = existsSync(dirPath);
      if (!dirExists) {
        if (cfg.required) {
          errors.push(
            `${rel(root, dirPath)}: required directory is missing for doc_root "${docRoot.path}"`,
          );
        }
        continue;
      }
      if (!statSync(dirPath).isDirectory()) {
        errors.push(`${rel(root, dirPath)}: declared topology directory is not a directory`);
        continue;
      }

      const readmeName = cfg.readme ?? (cfg.index === 'generated' ? 'README.md' : null);
      if (readmeName) {
        const readmePath = join(dirPath, readmeName);
        if (!existsSync(readmePath)) {
          errors.push(
            `${rel(root, readmePath)}: declared README is missing; create it or update directories.${dirName}.readme`,
          );
        } else if (!statSync(readmePath).isFile()) {
          errors.push(`${rel(root, readmePath)}: declared README is not a file`);
        } else if (cfg.index === 'generated') {
          try {
            ensureMarkers(readmePath);
          } catch {
            errors.push(
              `${rel(root, readmePath)}: generated index markers are missing; add ${START_MARKER} and ${END_MARKER}`,
            );
          }
        }
      }
    }

    const mdFiles = walkFiles(docRoot.fullPath, (name) => name.endsWith('.md'), options);
    markdownFiles += mdFiles.length;
    for (const filePath of mdFiles) {
      checkLocalMarkdownLinks(filePath, errors, root);
    }
  }

  return {
    manifestPath: loaded.manifestPath,
    docRootCount: loaded.docRoots.length,
    markdownFiles,
  };
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
  const generatedIndexCount = checkGeneratedIndexes(root, errors, options);
  const topologySummary = checkTopology(root, errors, options);

  for (const docRoot of docRoots) {
    const adrDir = join(docRoot, 'adr');

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
  console.log(`Checked generated indexes: ${generatedIndexCount}`);
  if (topologySummary) {
    console.log(`Checked topology manifest: ${rel(root, topologySummary.manifestPath)}`);
    console.log(`Checked topology doc roots: ${topologySummary.docRootCount}`);
    console.log(`Checked topology markdown links: ${topologySummary.markdownFiles}`);
  }
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

async function main() {
  const root = resolve(parseArg('--root', '.'));
  const options = {
    includeArchive: hasFlag('--include-archive'),
    decisionRegistryPath: parseArg('--decision-registry', null),
    topologyManifestPath: parseArg('--topology-manifest', null),
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
  if (cmd === 'check-index') {
    const errors = [];
    const checked = checkGeneratedIndexes(root, errors, options);
    if (errors.length > 0) {
      console.error('\nGenerated index checks failed:\n');
      for (const e of errors) console.error(`- ${e}`);
      process.exit(1);
    }
    console.log('Generated index checks passed');
    console.log(`Checked generated indexes: ${checked}`);
    return;
  }
  if (cmd === 'check-topology') {
    const errors = [];
    const summary = checkTopology(root, errors, options);
    if (errors.length > 0) {
      console.error('\nDoc topology checks failed:\n');
      for (const e of errors) console.error(`- ${e}`);
      process.exit(1);
    }
    if (!summary) {
      console.log('Doc topology manifest not found; skipped');
      return;
    }
    console.log('Doc topology checks passed');
    console.log(`Manifest: ${rel(root, summary.manifestPath)}`);
    console.log(`Checked topology doc roots: ${summary.docRootCount}`);
    console.log(`Checked topology markdown links: ${summary.markdownFiles}`);
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
  if (cmd === 'fix') {
    generateIndexes(root, options);
    checkGovernance(root, options);
    return;
  }
  console.error(
    'Usage: doc-governance [gen-index|check-index|check-topology|check|check-registry|run|fix] [--root <path>] [--include-archive] [--decision-registry <path>] [--topology-manifest <path>]',
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
