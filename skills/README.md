# Canonical Skills

This directory contains centralized, canonical documentation-governance skills.

Current canonical skills:

- `auto-doc-index`
- `discussion-logger`

**Architecture alignment skills** (`arch-preview`, `arch-review`) are **not** maintained here. Canonical copies live in the **Fulmail** monorepo (for example `.cursor/skills/arch-preview/` and `.cursor/skills/arch-review/`), with sync via `config/skills-auditor/sources.fulmail.json` and `pnpm skills:sync:apply`.

Policy:

- Keep exactly one canonical copy per skill listed above.
- Project repositories should reference these skills instead of duplicating
  local copies.
- If a project needs customization, add project-specific overlays in docs, not
  duplicated `SKILL.md` files.
