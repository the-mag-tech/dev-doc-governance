---
name: auto-doc-index
description: "Auto-generate ADR/Pitfall index tables from source files to prevent stale hand-maintained README indexes."
---

# Auto Doc Index

Generate derived index tables between `<!-- INDEX:START -->` and
`<!-- INDEX:END -->` markers. Treat README indexes as build artifacts, not
manual state.

## Use When

- Adding/updating ADR/Pitfall docs
- Creating a new doc directory that needs an index
- Fixing merge conflicts caused by hand-edited README tables

## Core Principle

Each document is the source of truth. Index tables are pure derived views.

## Workflow

1. Ensure doc files contain required metadata (`Status`, `Date`, title)
2. Ensure target README has index markers
3. Resolve the consuming repository's absolute root. If it already defines
   `gen:index`, use its configured package manager. Otherwise call the installed
   `doc-governance gen-index --root /absolute/consumer-repo`, or
   `node /absolute/dev-doc-governance/bin/doc-governance.mjs gen-index --root /absolute/consumer-repo`.
   The bundled generator supports its discovered ADR and pitfall directories;
   do not claim RFC or arbitrary-folder indexing without a matching implementation.
4. Verify with the same CLI's `check-index --root /absolute/consumer-repo`.

5. Include derived index updates in the authorized documentation change

## Boundaries

- Do not edit document content bodies
- Do not edit README content outside index markers
- Do not use this for editorial/manual curation lists
