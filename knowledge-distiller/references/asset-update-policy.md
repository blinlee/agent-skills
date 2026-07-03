# Asset Update Policy

## Purpose

Use this policy when re-distilling a corpus or adding new material to an existing `knowledge-assets/` directory. The goal is durable knowledge with traceable evolution, not duplicate summaries.

## Status Vocabulary

- `active`: current best distilled knowledge.
- `tentative`: plausible but weakly grounded or awaiting more evidence.
- `contested`: supported by some evidence but contradicted or bounded by other evidence.
- `refined`: still valid but narrowed, renamed, or sharpened by later evidence.
- `superseded`: no longer the current framing; keep it for genealogy and link to the replacement.

## Evidence Precedence

Use the strongest available evidence level:

1. `verbatim`: exact source phrasing or direct quote.
2. `artifact`: source-backed paraphrase, table, example, or documented behavior.
3. `inference`: agent synthesis from source evidence.

Higher evidence does not automatically win if context is narrower. A verbatim tactical rule can be bounded by a broader artifact-backed mechanism.

## Update Decisions

For each new or changed idea, choose one action:

| Action | When to use |
| --- | --- |
| Add | The idea is new and materially useful. |
| Refine | The idea is the same but needs better mechanism, boundary, title, or evidence. |
| Coexist | Two framings apply in different contexts. Link them with `bounds`, `contradicts`, or `refines`. |
| Supersede | The new asset replaces the old framing. Keep the old id and set `Superseded by`. |
| Defer | Evidence is too weak or noisy. Put it in `open-questions.md`. |
| Correct | The source claim is outdated or misleading as reusable knowledge; write the corrected asset wording and record the intervention in `currentness-ledger.md`. |
| Supplement | The source claim is incomplete; add missing boundary or context and record the intervention in `currentness-ledger.md`. |

## Merge Rules

- Merge only by meaning, not by shared keywords.
- Keep minority views when they reveal a boundary, exception, or contradiction.
- Do not delete meaningful details to make an asset look cleaner.
- Move long evidence into `evidence-index.md`, not out of the knowledge base.
- Preserve source ids through every update.
- Do not let source-production noise become a new asset or a title.
- Do not silently replace source wording with updated agent judgment. Keep the source claim, the currentness assessment, and the corrected or supplemented claim auditable.

## Re-Distillation Flow

1. Build or refresh the Source Pack.
2. Read `knowledge-assets/index.md` and `asset-manifest.json`.
3. Compare new concepts against existing `KA-####` ids.
4. Apply one update decision per concept.
5. Update `evidence-index.md`, `concept-map.md`, `conflicts.md`, and `currentness-ledger.md`.
6. Update `asset-manifest.json` and `index.md`.
7. Write a versioned run report under `reports/`.
8. Run `kd_asset_validate.py` and record validation results.

## Versioned Reports

Use reports for run history:

```text
reports/
├── distillation-report-YYYYMMDD.md
└── distillation-report.md
```

`distillation-report.md` may be the latest report or a short pointer to the latest version. Do not use reports as the canonical asset store.

## Supersession Example

```markdown
## KA-0008: Only trade strong consensus
- Status: superseded
- Superseded by: KA-0021

**Notes:** Replaced because later evidence narrowed the rule to early-cycle consensus only.
```

```markdown
## KA-0021: Consensus only matters when cycle support exists
- Status: active
- Supersedes: KA-0008
- Related: refines KA-0008; bounded-by KA-0014
```
