---
name: discussion-logger
description: "Capture substantive ADR/design/research decision journeys as narrative discussion logs with human judgment attribution."
---

# Discussion Logger

Record *why* a decision was made, not only *what* was decided.

## Supported Types

- ADR (`doc/adr/`)
- Design docs (`doc/design/`)
- Research docs (`doc/research/`)
- Pitfalls (`doc/pitfall/`)

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

### Key Human Insights
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

2. Append usage record to `USAGE.md`
3. Run verification script:

```bash
bash skills/discussion-logger/verify-usage.sh
```

## Anti-Patterns

- Raw chat dump
- Agent-centric log without human decision points
- Feature-list summary without reasoning path
