# Playbook Profile

## Goal

Render reusable operating knowledge without flattening context.

## Required Sections

```markdown
# [Corpus Name] Playbook

## 1. Operating Principles
## 2. Patterns and Triggers
## 3. Procedures
## 4. Checks and Guardrails
## 5. Failure Modes
## 6. Examples
## 7. Evidence Appendix
```

## Pattern Format

```markdown
### [Pattern Name]
**Use When:** ...
**Do:** ...
**Check:** ...
**Avoid:** ...
**Failure Mode:** ...
**Evidence:** S002, S009
```

## Rules

- Keep trigger conditions explicit.
- Preserve "do not use when" boundaries.
- Separate stable procedure from one-off anecdote.
- Convert examples into rules only when multiple sources or strong mechanism support transferability.
- Keep anti-patterns as first-class output.

## Process Variant

For project/product/management corpora, add:

- roles
- artifacts
- gates
- escalation rules
- decision records
- review cadence
