# dev-doc-governance

Shared documentation governance bundle for engineering repositories.

## Scope

- Generate ADR and pitfall index tables between `INDEX` markers
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
doc-governance check --root /path/to/repo
doc-governance check-registry --root /path/to/repo
doc-governance run --root /path/to/repo
doc-governance check --root /path/to/repo --include-archive
doc-governance check --root /path/to/repo --decision-registry ./decision-registry.json
```

## Repository Integration

Add scripts in consumer repository:

```json
{
  "scripts": {
    "gen:index": "doc-governance gen-index --root .",
    "doc:check": "doc-governance check --root .",
    "doc:governance": "doc-governance run --root ."
  }
}
```

## Notes

- This is intentionally minimal for pilot adoption.
- Cross-repo anti-stale references are managed via `decision-registry.json`.
- Future iterations may add richer report output formats.

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
