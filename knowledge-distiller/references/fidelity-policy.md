# Fidelity Policy

## Core Principle

Distillation is high-fidelity restructuring. It is not lossy summarization.

The output may be more organized than the source, but it must preserve the source's working knowledge: examples, caveats, boundary cases, exceptions, contradictions, vivid phrasing, and practical judgment.

High fidelity starts with full coverage. A synthesis cannot claim corpus-level authority unless the agent semantically reviewed every readable source in the selected scope or explicitly labeled the output as partial.

## Evidence Levels

Use these labels when evaluating extracted items:

| Level | Meaning |
|---|---|
| `verbatim` | Direct quote or near-direct source wording |
| `artifact` | Source-backed paraphrase from a document, slide, transcript, or note |
| `inference` | Agent interpretation based on multiple source items |
| `impression` | Human-provided impression or weakly grounded reading |

Prefer `verbatim` and `artifact`. Use `inference` when modeling is necessary, but label it. Avoid `impression` unless the corpus itself contains subjective commentary.

## Preserve Detail Without Clutter

Use layered output:

- main report for synthesis
- evidence tables for detail
- appendices for examples, variants, and disagreements
- Source Pack for re-entry

Do not delete important detail just because it makes the report longer.

## Coverage and Omission

Every report-grade run should state:

- what source scope was included
- which sources or chunks were unreadable or intentionally out of scope
- whether batching was used
- where long evidence, examples, or variants were moved
- what was deferred for later review

## Contradictions

Preserve contradictions instead of resolving them prematurely.

Use this pattern:

```markdown
## Conflict: <topic>
- View A: ... (S001)
- View B: ... (S014)
- Current treatment: coexist / newer supersedes older / unresolved
- Reason: ...
```

## Compression Risk

Every report should state what was condensed, deferred, or left unresolved. Silent omission is a failure.
