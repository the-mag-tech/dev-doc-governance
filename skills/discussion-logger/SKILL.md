---
name: discussion-logger
description: "Capture substantive ADR/design/research decision journeys as narrative discussion logs with human judgment attribution."
---

# Discussion Logger

Record *why* a decision was made, not only *what* was decided.

## Supported Types

- ADR, design, research, and pitfall decision journeys.
- Use the consuming repository's actual document topology; `doc/adr/`,
  `doc/design/`, `doc/research/`, and `doc/pitfall/` are examples, not required roots.

## Use When

- A substantive discussion session ends
- An ADR/design/research direction changes
- User asks to "log discussion" or "save rationale"

## Session Template

```markdown
## Session YYYY-MM-DD — [Short Title]

### Starting Point
...

### Decision Journey
...

### Attributed Insights (when present)
...

### Downstream Effects
...

### Open Questions
...
```

## Required Follow-up

1. Link discussion from parent doc:

```markdown
> Discussion: [discussion log](xxx.discussion.md)
```

2. Keep the decision log and any requested usage record in the consuming
   repository or its private evidence location. Do not append private discussion
   details to the shared skill installation's `USAGE.md`.
3. Run that repository's documentation checks. When it uses Doc Governance,
   run `doc-governance check --root /absolute/consumer-repo` (or the equivalent
   configured package script). The bundled `verify-usage.sh` checks only this
   skill repository's usage markers; it is not validation of the new decision log.

Include human judgments only when the source contains them. Distinguish them from agent analysis and tool observations; omit empty template sections instead of inventing a viewpoint or treating a task instruction as an endorsed conclusion.

## Anti-Patterns

- Raw chat dump
- Inventing human decision points or attributing an agent inference to the user
- Feature-list summary without reasoning path
