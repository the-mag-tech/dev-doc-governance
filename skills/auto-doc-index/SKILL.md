---
name: auto-doc-index
description: "Auto-generate ADR/Pitfall index tables from source files to prevent stale hand-maintained README indexes."
---

# Auto Doc Index

Regenerate ADR/Pitfall README tables from the documents' title, `Status` and `Date`.
Only the text between `<!-- INDEX:START -->` and `<!-- INDEX:END -->` is derived.
Preserve source bodies and everything outside those markers.

Resolve the consumer's absolute repository root and index markers. Use its
configured `gen:index` script when present; otherwise run
`doc-governance gen-index --root /absolute/consumer-repo`, or
`node /absolute/dev-doc-governance/bin/doc-governance.mjs gen-index --root /absolute/consumer-repo`.
For the bundled parser, ADR filenames are `NNN-*.md` (three digits), with
`# ADR-NNN: Title`, a `Status:` line (or `## Status` section), and
`Date: YYYY-MM-DD`. Pitfalls use `PIT-N*.md`, `# PIT-N: Title` and bold field
labels such as `**Area:**`, `**Severity:**`, `**Status:**`. These are this generator's
conventions; inspect a different consumer generator before applying them there.

Compare generated rows with the intended source-file inventory: an unsupported
filename can be silently omitted while generation and `check-index` both pass.
Report mismatches instead of silently renaming source documents. Then run the same
CLI's `check-index --root /absolute/consumer-repo` and include only the resulting
authorized documentation changes.

The bundled generator discovers ADR and pitfall directories. Inspect an actual
implementation before claiming RFC or arbitrary-folder support. Editorial lists
remain manual; do not turn them into generated indexes.
