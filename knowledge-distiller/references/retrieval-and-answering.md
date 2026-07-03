# Retrieval and Answering

## Purpose

Use this process when answering from an existing `knowledge-assets/` directory. The goal is source-backed reuse, not a fresh free-form summary.

## Standard Answer Flow

1. Classify the user's intent.
2. Read `knowledge-assets/index.md`.
3. Read `asset-manifest.json` if present.
4. Open the profile-specific asset files named by the index.
5. Follow `Related`, `Supersedes`, and `Superseded by` links for relevant `KA-####` entries.
6. Check `conflicts.md`, `currentness-ledger.md`, and `open-questions.md` before making a clean claim.
7. Use `evidence-index.md` and `source-pack/` to verify source ids or inspect source context.
8. Answer with asset ids, source ids, grounding, currentness, confidence, and boundaries.

## Intent Routing

| User intent | Start with | Then check |
| --- | --- | --- |
| philosophy, mindset, principles | `core-anchors.md`, `principles.md` | `mechanisms.md`, `conflicts.md`, `evidence-index.md` |
| why something works | `mechanisms.md` | `principles.md`, `concept-map.md`, source chunks |
| how to act | `playbook.md` | `mechanisms.md`, `evidence-index.md`, `conflicts.md` |
| factor research | `factor-seeds.md` | `mechanisms.md`, `evidence-index.md`, `open-questions.md` |
| concept relation | `concept-map.md` | linked assets, relation notes, source chunks |
| contradiction or exception | `conflicts.md`, `open-questions.md` | relevant profile files and evidence |
| currentness or old material | `currentness-ledger.md` | relevant asset, evidence index, source pack |
| source audit | `evidence-index.md` | `source-pack/source_manifest.json`, `chunk_index.json` |

## Answer Template

Use this shape unless the user asks for another format:

```markdown
## Short Answer
[Direct answer with the strongest applicable asset ids.]

## Supporting Assets
- `KA-0001`: [why relevant], sources: S001, S003

## Evidence
[Brief evidence summary with source ids and chunk ids when available.]

## Boundaries
[Where the answer does not apply; contradictions or weak spots.]

## Confidence
[strong / medium / weak / contested], because [reason].

## Currentness
[current / likely-current / possibly-outdated / outdated / needs-verification], with basis.
```

For short answers, compress the headings into prose but keep asset ids and confidence.

## Philosophical Norms

- Do not answer from memory when assets exist; retrieve first.
- Do not convert a slogan into a doctrine unless the asset includes mechanism and boundary.
- Do not promote a tactic to a principle unless cross-source evidence or a clear mechanism supports it.
- Treat `single-source` grounding as a hypothesis, not a settled doctrine.
- Treat old or time-sensitive source claims as claims to assess, not scripture.
- If an asset used LLM judgment to correct or supplement the source, mention that intervention and cite the ledger/report note.
- Treat contradictions as information. Explain the split instead of smoothing it away.
- Preserve meaningful source detail. If a short answer omits nuance, point to the asset that carries the detail.
- Do not use source-production noise, personal labels, platform junk, or decorative text as evidence.

## When Assets Are Missing

If no relevant asset exists, say so and fall back to the Source Pack:

1. Search `source-pack/chunk_index.json` for likely source locations.
2. Inspect source chunks.
3. Label the answer as a fresh inference.
4. Add a suggested `open-questions.md` or `saved-queries.md` entry if the question is likely to recur.
