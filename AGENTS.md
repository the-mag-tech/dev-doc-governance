# AGENTS.md — dev-doc-governance

## Purpose

Provide shared documentation governance tooling for multiple repositories.

## Mandatory Rules

1. Keep CLI behavior deterministic and repo-agnostic.
2. Use `decision-registry.json` as the source of truth for cross-repo decision ids.
3. Prefer stable decision references in docs: `@decision repo:NNN`.
4. Do not introduce repo-specific assumptions into default checks.
5. Update `README.md` whenever CLI commands or rules change.

## Local Validation

```bash
node ./bin/doc-governance.mjs gen-index --root .
node ./bin/doc-governance.mjs check --root .
node ./bin/doc-governance.mjs check-registry --root .
```
