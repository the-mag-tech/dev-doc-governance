---
name: auto-doc-index
description: "Auto-generate ADR/RFC/Pitfall index tables from source files to prevent stale hand-maintained README indexes."
---

# Auto Doc Index

Generate derived index tables between `<!-- INDEX:START -->` and
`<!-- INDEX:END -->` markers. Treat README indexes as build artifacts, not
manual state.

## Use When

- Adding/updating ADR/RFC/Pitfall docs
- Creating a new doc directory that needs an index
- Fixing merge conflicts caused by hand-edited README tables

## Core Principle

Each document is the source of truth. Index tables are pure derived views.

## Workflow

1. Ensure doc files contain required metadata (`Status`, `Date`, title)
2. Ensure target README has index markers
3. Run:

```bash
pnpm gen:index
```

4. Commit derived index updates

## Boundaries

- Do not edit document content bodies
- Do not edit README content outside index markers
- Do not use this for editorial/manual curation lists
