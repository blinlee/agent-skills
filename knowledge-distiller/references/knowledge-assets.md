# Knowledge Assets

## Goal

Separate durable distilled assets from one-time delivery reports.

Reports explain what this distillation run produced. Knowledge assets are the reusable material future agents should read, search, merge, and update.

## Standard Layout

Use this layout under the corpus root:

```text
<corpus-root>/
├── source-pack/
│   ├── source_manifest.json
│   ├── chunk_index.json
│   ├── evidence_snippets.json
│   ├── concept_table.json
│   └── relation_notes.json
├── knowledge-assets/
│   ├── index.md
│   ├── asset-manifest.json
│   ├── answer-protocol.md
│   ├── core-anchors.md
│   ├── principles.md
│   ├── mechanisms.md
│   ├── playbook.md
│   ├── factor-seeds.md
│   ├── concept-map.md
│   ├── evidence-index.md
│   ├── conflicts.md
│   ├── currentness-ledger.md
│   ├── saved-queries.md
│   └── open-questions.md
└── reports/
    └── distillation-report.md
```

Create only the asset files that match the selected profiles. Do not create empty placeholders just to satisfy the tree.

For exact entry templates, read `asset-schemas.md`. For answering questions from an existing asset set, read `retrieval-and-answering.md`. For re-distillation and updates, read `asset-update-policy.md`.

## Asset Roles

- `index.md`: entrypoint for future agents; lists available assets, profile scope, source pack path, and update notes.
- `asset-manifest.json`: machine-readable table of contents, profiles, source pack pointer, asset file list, source ids, and validation status.
- `answer-protocol.md`: corpus-specific retrieval shortcuts and any deviations from the standard answering protocol.
- `core-anchors.md`: memorable but source-backed anchors, each with principle, mechanism, boundary, and evidence.
- `principles.md`: reusable judgment rules and their caveats.
- `mechanisms.md`: causal, behavioral, operational, or structural mechanisms.
- `playbook.md`: actionable patterns, triggers, checks, risks, examples, and failure modes.
- `factor-seeds.md`: research hypotheses with observable proxies, data needs, tests, refutation, caveats, and evidence.
- `concept-map.md`: graph-ready concept table and relation table.
- `evidence-index.md`: claim-to-source and source-to-claim lookup.
- `conflicts.md`: contested assets, contradictions, unresolved splits, and possible reconciliation paths.
- `currentness-ledger.md`: audit trail for outdated, period-specific, corrected, narrowed, or LLM-supplemented claims.
- `saved-queries.md`: recurring question patterns and the asset search path future agents should use.
- `open-questions.md`: unresolved contradictions, weak hypotheses, missing data, and follow-up leads.

## Report Role

`reports/distillation-report.md` is not the knowledge base. It should summarize:

- source scope and profile choices
- generated assets and paths
- major findings
- fidelity and noise-review notes
- validation result
- known gaps and next steps

The report may quote from assets, but the assets are canonical for future reuse.

## Reuse Rules

- Future agents should start from `knowledge-assets/index.md`, not from the delivery report.
- Every durable asset entry should cite source ids such as `S003`; use chunk ids or line ranges when useful.
- Keep assets modular. Do not bury factor seeds inside a long philosophy report.
- If the same corpus is re-distilled, update existing assets or create a versioned run report; do not duplicate the asset set blindly.
- Preserve meaningful detail in assets. Move long evidence into `evidence-index.md` instead of deleting it.
- Use stable `KA-####` ids for durable entries so future agents can cite and relate assets.
- Keep status and evidence fields current: `active`, `tentative`, `contested`, `refined`, or `superseded`; `verbatim`, `artifact`, or `inference`.
- Keep currentness fields current when sources are old, undated, or time-sensitive. If the agent corrects or supplements a source claim, record it in `currentness-ledger.md` or the delivery report.
- Before answering from assets, follow `retrieval-and-answering.md`: read the index, retrieve relevant assets, check conflicts and open questions, verify evidence, then answer with asset ids and confidence.
