# Knowledge Distiller

Knowledge Distiller turns local text-like corpora into high-fidelity, source-backed knowledge assets. It is designed for Markdown notes, courseware, books, research notes, project logs, product documents, and chat transcripts.

The skill is agent-facing. It uses small deterministic scripts for source intake, chunking, and validation, while semantic work remains with the agent: full-corpus reading, noise filtering, deduplication, contradiction handling, currentness review, modeling, and durable asset writing.

## What It Produces

A distillation run creates three layers:

- `source-pack/`: manifest, chunk index, evidence snippets, concept table, and relation notes.
- `knowledge-assets/`: reusable `KA-####` assets such as principles, mechanisms, playbooks, factor seeds, concept maps, evidence indexes, conflicts, currentness ledgers, and open questions.
- `reports/`: one-time delivery reports that explain the run, generated assets, validation status, and known gaps.

Reports are not the knowledge base. Future agents should start from `knowledge-assets/index.md`.

## Core Workflow

1. Select scope and output profile.
2. Build the Source Pack.
3. Semantically read every readable source in scope.
4. Filter source-production noise and quarantine ambiguous fragments.
5. Deduplicate by meaning and preserve real variants.
6. Extract claims, concepts, examples, mechanisms, tensions, and open questions.
7. Classify concepts into layers.
8. Link support, contradiction, refinement, boundary, and evolution relations.
9. Review currentness for old, undated, or time-sensitive claims.
10. Write durable knowledge assets and a delivery report.
11. Validate references, assets, fidelity, noise handling, contradictions, and currentness handling.

## Deterministic Helpers

Run from the skill root:

```bash
python3 scripts/kd_manifest.py <corpus-root>
python3 scripts/kd_chunk.py <corpus-root>/source-pack/source_manifest.json
python3 scripts/kd_validate.py --manifest <corpus-root>/source-pack/source_manifest.json --chunks <corpus-root>/source-pack/chunk_index.json
python3 scripts/kd_asset_validate.py --assets <corpus-root>/knowledge-assets --source-pack <corpus-root>/source-pack --strict
```

The scripts do not decide semantic meaning. They create stable containers and check structural contracts.

## Output Profiles

- `philosophy`: principles, worldview, doctrine, and cognitive anchors.
- `playbook`: operating rules, workflows, tactics, checks, and failure modes.
- `factor-seed`: research hypotheses, mechanisms, proxies, data needs, and refutation paths.
- `process`: project, product, or management systems.
- `memory-session`: durable lessons, decisions, changed beliefs, and follow-up threads.
- `voice`: author style and judgment habits when explicitly requested.
- `knowledge-map`: concepts and relationships.

## Validation

Validate the skill package:

```bash
python3 /Users/blinlee/.agents/skills/skill-creator-pro/scripts/quick_validate.py /path/to/knowledge-distiller
```

For script smoke checks, create a small corpus under `/tmp` and run the deterministic helpers against that corpus. Keep generated Source Packs and reports out of the skill directory.
