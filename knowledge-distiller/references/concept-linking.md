# Concept Linking

## Goal

Connect concepts across sources without flattening differences.

## Relation Types

Use a small canonical vocabulary:

- `supports`
- `contradicts`
- `refines`
- `exemplifies`
- `operationalizes`
- `requires`
- `causes`
- `bounds`
- `supersedes`
- `coexists-with`

Avoid creating new relation labels unless the existing vocabulary clearly fails.

## Linking Rules

- Duplicate: same meaning, same role, compatible evidence.
- Variant: same family, different wording, scope, or emphasis.
- Refinement: later or more precise version of earlier concept.
- Contradiction: claims cannot both hold in the same context.
- Boundary: one concept limits when another applies.
- Evolution: source appears to change position over time.

Do not merge concepts just because they share keywords. Match meaning, role, and context.

## Conflict Handling

When concepts disagree:

1. Preserve both.
2. Check whether time, context, or domain explains the difference.
3. Mark treatment: `coexist`, `bounds`, `supersede`, `refine`, or `unresolved`.
4. Keep evidence for both sides.

Do not resolve contradictions for aesthetic neatness. A contradiction may be the most valuable asset in the corpus because it reveals a boundary, change in belief, hidden assumption, or failure mode.

## Knowledge Map Output

Use graph-ready tables rather than requiring a graph engine:

```markdown
| Concept | Layer | Sources | Variants | Relations |
|---|---|---|---|---|
| ... | L3 | S004, S009 | ... | supports -> ... |
```
