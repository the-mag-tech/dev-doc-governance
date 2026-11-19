---
name: discussion-logger
description: "Capture substantive ADR/design/research decision journeys as narrative discussion logs with human judgment attribution."
---

# Discussion Logger

Preserve a substantive decision's reasoning path in the consuming repository's
actual documentation topology. Record the starting question, alternatives and
turning points, decision and downstream effects, and unresolved questions. Use a
dated `Session YYYY-MM-DD — Title` section; omit unsupported or empty sections.

Attribute human judgments only to supplied human statements. Keep agent proposals,
tool observations and verified facts distinct; a request is not endorsement of
an inferred conclusion. Do not replace the narrative with a feature list or raw
chat dump. Preserve existing human edits when extending a log.

Link the log from its parent document, for example
`> Discussion: [discussion log](xxx.discussion.md)`.
Store private details only in the consumer's authorized private evidence location,
never this shared installation's `USAGE.md`. Run the consumer's documentation
checks; with Doc Governance use `doc-governance check --root /absolute/consumer-repo`
or its configured equivalent. The bundled `verify-usage.sh` validates this skill's
usage markers, not the new discussion.
