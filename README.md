# dev-doc-governance

Shared documentation governance bundle for engineering repositories.

## Scope

Doc Governance is the umbrella CLI. It keeps separate capabilities composable:

- Doc Topology: declared file tree contract
- Auto Index: derived ADR and pitfall index generation
- Link Integrity: local references remain resolvable
- Metadata Contract: per-doc required fields
- Decision Registry: stable cross-repo decision references

Topology governs where. Index governs list.

- Generate ADR and pitfall index tables between `INDEX` markers
- Check generated ADR and pitfall indexes without mutating files
- Validate optional doc topology manifests
- Validate ADR metadata fields (`Status`, `Date`)
- Validate ADR to discussion log pairing
- Treat `*.discussion.md` and `*.exploration.md` as ADR sidecars (no index row, no `Status`/`Date` header enforcement)
- Validate project-level `AGENTS.md` and optional `CLAUDE.md` links
- Validate package-level `AGENTS.md` links (`apps/*`, `packages/*`, and nested AGENTS files)
- Validate `SKILL.md` local links and heading presence
- Exclude `.archive` by default; support opt-in archive scanning

## CLI

```bash
doc-governance gen-index --root /path/to/repo
doc-governance check-index --root /path/to/repo
doc-governance check-topology --root /path/to/repo
doc-governance check --root /path/to/repo
doc-governance check-registry --root /path/to/repo
doc-governance run --root /path/to/repo
doc-governance fix --root /path/to/repo
doc-governance check --root /path/to/repo --include-archive
doc-governance check --root /path/to/repo --decision-registry ./decision-registry.json
doc-governance check-topology --root /path/to/repo --topology-manifest ./doc-governance.topology.yaml
```

Command behavior:

- `gen-index` mutates ADR and pitfall README index blocks.
- `check-index` is non-mutating and fails when generated indexes are stale or markers are missing.
- `check-topology` is non-mutating and validates a repo-local topology manifest.
- `check` is non-mutating and composes metadata, link, registry, stale-index, and topology checks when a topology manifest exists.
- `run` and `fix` generate indexes first, then run `check`.
- If no topology manifest exists, topology checks are skipped so consumer repos can adopt the contract gradually.

## Repository Integration

Add scripts in consumer repository:

```json
{
  "scripts": {
    "gen:index": "doc-governance gen-index --root .",
    "doc:check:index": "doc-governance check-index --root .",
    "doc:check:topology": "doc-governance check-topology --root .",
    "doc:check": "doc-governance check --root .",
    "doc:governance": "doc-governance run --root ."
  }
}
```

## Doc Topology

Add a repo-local manifest at one of:

- `doc-governance.topology.yaml`
- `doc-governance.topology.yml`
- `doc-governance.topology.json`
- `.doc-governance/topology.yaml`
- `.doc-governance/topology.yml`
- `.doc-governance/topology.json`

Minimal YAML example:

```yaml
version: 1
doc_roots:
  - path: apps/magpie-mobile/doc
    root_files:
      allow:
        - README.md
        - ROADMAP.md
    directories:
      adr:
        required: true
        readme: README.md
        kind: decisions
        index: generated
      pitfall:
        required: true
        readme: README.md
        kind: pitfalls
        index: generated
      research:
        required: true
        readme: README.md
        kind: research
      release:
        required: false
        kind: release-materials
```

Topology rules:

- Every configured `doc_root` must exist and be a directory.
- Files directly under a `doc_root` must be listed in `root_files.allow`.
- Directories directly under a `doc_root` must be declared in `directories`.
- Required directories must exist.
- If a directory declares `readme`, that README must exist.
- If a directory declares `index: generated`, its README defaults to `README.md` and must contain `<!-- INDEX:START -->` and `<!-- INDEX:END -->`.
- Local markdown links inside configured doc roots must resolve.
- `.archive/` is skipped by default and included with `--include-archive`.

## Notes

- This is intentionally minimal for pilot adoption.
- Cross-repo anti-stale references are managed via `decision-registry.json`.
- Future iterations may add richer report output formats.
- The test suite includes non-interactive agent-shell profiles for Codex, Cursor Agent, and Claude Code style invocation: pipe stdio, `CI=1`, `TERM=dumb`, absolute `--root`, and a cwd outside the target repo.

## Agent E2E

External agent E2E uses an isolated `/private/tmp/dev-doc-governance-agent-e2e.*`
bundle containing only:

- `bin/doc-governance.mjs`
- `test/doc-governance.test.mjs`
- `decision-registry.json`

The real workspace is not handed to external agents.

```bash
npm run test:e2e:agents:local
npm run test:e2e:agents
```

`test:e2e:agents:local` builds the isolated bundle and runs the 18-test suite
locally. `test:e2e:agents` runs the same suite through Claude Code, Codex, and
Cursor Agent non-interactive CLIs.

Expected agent auth:

- Claude Code: `claude -p` works.
- Codex: `codex exec --skip-git-repo-check ...` works. `CODEX_BIN` can point to
  a specific binary, for example `/Applications/Codex.app/Contents/Resources/codex`.
- Cursor Agent: `cursor-agent -p` works. `CURSOR_AGENT_BIN` can point to a
  specific binary.

## Decision Registry (Cross-Repo Anti-Stale)

`decision-registry.json` is the central source of truth for cross-repo ADR references.

- Canonical decision id format: `repo:NNN` (example: `skillet:003`)
- Recommended markdown reference form: `@decision skillet:003`
- Registry contains canonical GitHub URL, status, and title

Rules are managed inside registry `rules`:

- `allowRawGithubAdrLinks`: allow/disallow direct GitHub ADR URLs
- `requireDecisionIdForCrossRepoReferences`: require `@decision` ids when cross-repo ADR links exist

Archive behavior:

- `.archive/` is excluded by default to preserve historical snapshots.
- Use `--include-archive` only when you intentionally want to lint/migrate archived references.

Validation behavior:

- If `--decision-registry` is provided, CLI uses that file.
- Otherwise CLI checks local `./decision-registry.json`.
- If none exists, CLI falls back to bundled registry in this package.

You can run strict checks with:

```bash
doc-governance check-registry --root /path/to/repo --decision-registry ./decision-registry.json
```
