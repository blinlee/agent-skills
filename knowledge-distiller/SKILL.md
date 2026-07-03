---
name: knowledge-distiller
description: Distill local corpora such as markdown notes, courseware, books, research notes, project logs, product docs, or chat transcripts into high-fidelity, source-backed knowledge artifacts. Use this skill whenever the user asks to extract philosophy, principles, playbooks, frameworks, decision rules, knowledge maps, factor-research seeds, process doctrine, or durable lessons from a body of source material, even if they only say "summarize" but clearly need reusable knowledge rather than a short summary.
---

# Knowledge Distiller

## Purpose

Turn a local corpus into reusable, source-backed knowledge without losing meaningful detail. This skill is for agent use: run the small deterministic scripts for intake/chunking/validation, then use semantic judgment for extraction, modeling, and rendering.

## Core Rules

- Read the whole scoped corpus semantically. Scripts can index and chunk, but the agent must review all readable materials before report-grade distillation.
- Distillation is not compression. Preserve examples, caveats, boundary cases, contradictions, and source-specific phrasing when they carry meaning.
- Noise is not knowledge. Filter headers, footers, page numbers, watermarks, downloader ads, OCR edge text, platform boilerplate, and decorative residues before modeling.
- Deduplicate by meaning, not keywords. Preserve variants, boundaries, and conflicts when context differs.
- Treat sources as primary evidence, not scripture. The agent may correct or supplement outdated or incomplete source claims in final assets, but every intervention must be logged in a currentness ledger or delivery report.
- Keep the architecture light. Use a Source Pack, Markdown reports, and optional JSON sidecars; do not build a database, service, graph engine, or daemon.
- Every major claim needs a source pointer such as `S003` or must be labeled as inference.
- Factor seeds are research hypotheses, not trading advice or validated alpha.

## Required First Reads

Read these references before substantive work:

1. `references/source-intake.md`
2. `references/distillation-philosophy.md`
3. `references/noise-filtering.md`
4. `references/fidelity-policy.md`
5. `references/distillation-layers.md`
6. `references/currentness-review.md`
7. `references/knowledge-assets.md`
8. `references/asset-schemas.md`
9. `references/asset-update-policy.md`
10. `references/output-profiles.md`

Then read the profile file that matches the user request:

| User goal | Profile reference |
| --- | --- |
| philosophy, doctrine, mindset, principles, heart method | `references/profile-philosophy.md` |
| factor ideas, quant research seeds, testable market hypotheses | `references/profile-factor-seed.md` |
| operating method, SOP, tactics, checklist, workflow | `references/profile-playbook.md` |
| project/product/management process, gates, roles, escalation | `references/profile-process.md` |
| voice, style, judgment habits, author-specific phrasing | `references/profile-voice.md` |
| chat logs, work logs, session summaries, durable lessons | `references/profile-memory-session.md` |
| concept graph, knowledge map, relations | `references/concept-linking.md` and `references/output-profiles.md` |

Read `references/modeling-method.md` before writing final synthesis.
Read `references/retrieval-and-answering.md` when the task is to answer questions from an existing `knowledge-assets/` directory instead of running a fresh distillation.

## Mandatory Deterministic Steps

From the skill root:

```bash
python3 scripts/kd_manifest.py <corpus-root>
python3 scripts/kd_chunk.py <corpus-root>/source-pack/source_manifest.json
```

This creates:

- `<corpus-root>/source-pack/source_manifest.json`
- `<corpus-root>/source-pack/chunk_index.json`
- `<corpus-root>/source-pack/evidence_snippets.json`
- `<corpus-root>/source-pack/concept_table.json`
- `<corpus-root>/source-pack/relation_notes.json`

The last three files are semantic scaffolds. The script only creates their schemas; the agent fills them while extracting evidence, concepts, and relations.

After writing a report, validate:

```bash
python3 scripts/kd_validate.py \
  --manifest <corpus-root>/source-pack/source_manifest.json \
  --chunks <corpus-root>/source-pack/chunk_index.json \
  --report <report.md> \
  --profile <general|philosophy|factor-seed|playbook|process|memory-session|voice>
```

If scripts cannot run, manually create the same Source Pack fields before continuing.

After writing durable assets, validate the asset set:

```bash
python3 scripts/kd_asset_validate.py \
  --assets <corpus-root>/knowledge-assets \
  --source-pack <corpus-root>/source-pack \
  --json
```

Use `--strict` for report-grade asset sets that should include management files such as `asset-manifest.json`, `answer-protocol.md`, and `evidence-index.md`.

## Workflow

1. Select profile and scope.
2. Build Source Pack with the deterministic scripts.
3. Semantically read every readable source in scope; record access or coverage gaps.
4. Filter source-production noise and quarantine ambiguous fragments.
5. Deduplicate repeated content by meaning, preserving real variants.
6. Extract claims, concepts, examples, mechanisms, tensions, and open questions.
7. Classify concepts into Layer 0-5.
8. Link duplicates, variants, support, contradiction, refinement, boundary, and evolution.
9. Review currentness and context for old, undated, or time-sensitive claims; log any agent correction or supplementation.
10. Model the profile-specific framework.
11. Write reusable knowledge assets under `<corpus-root>/knowledge-assets/` using stable `KA-####` ids.
12. Render a one-time delivery report under `<corpus-root>/reports/`.
13. Validate coverage, Source Pack, reusable assets, citations, fidelity, noise leakage, contradiction handling, currentness handling, and profile fit.

## Output Defaults

Default output is a reusable knowledge asset set plus a one-time delivery report. Use `references/knowledge-assets.md` for asset layout and `references/report-template.md` for report shape.

When the user is vague, default to:

- `philosophy` for mindset, doctrine, principles, or "心法"
- `playbook` for methods, workflows, SOPs, or "怎么做"
- `factor-seed` only when the user explicitly wants research hypotheses, market mechanisms, variables, or factors
- `process` for project, product, management, gate, role, or escalation extraction
- `memory-session` for chat logs, work logs, session summaries, or durable follow-up leads

## Gotchas

- Do not produce a short summary when the user needs durable knowledge.
- Do not claim corpus-level distillation if the agent did not semantically read the whole scoped corpus.
- Do not treat the delivery report as the reusable knowledge base.
- Do not collapse contradictions into a fake clean doctrine.
- Do not silently replace source claims with the agent's own updated judgment; record the source claim, assessment, and correction.
- Do not convert source noise into final rules.
- Do not merge concepts because they share keywords; merge only when their meaning matches.
- Do not script semantic judgment with regex or if/else rules.
- Do not make this trader-only. Finance is a profile, not the core skill.
- Do not copy reference repo vocabulary into the final report unless it serves the user's corpus.
