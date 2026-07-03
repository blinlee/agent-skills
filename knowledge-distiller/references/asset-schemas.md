# Asset Schemas

## Purpose

Use these schemas for durable `knowledge-assets/` files. Reports can vary by run, but reusable assets should stay predictable so future agents can search, merge, cite, and answer from them.

## Required Management Files

Every complete asset set should include:

```text
knowledge-assets/
├── index.md
├── asset-manifest.json
├── evidence-index.md
├── conflicts.md
├── currentness-ledger.md
├── answer-protocol.md
└── open-questions.md
```

Profile-specific files are created only when relevant: `core-anchors.md`, `principles.md`, `mechanisms.md`, `playbook.md`, `factor-seeds.md`, `concept-map.md`.

## Asset Manifest

`asset-manifest.json` is the machine-readable table of contents.

```json
{
  "schema_version": "1.0",
  "generated_at": "YYYY-MM-DD",
  "corpus": "corpus name",
  "source_pack": "../source-pack/source_manifest.json",
  "profiles": ["philosophy"],
  "assets": [
    {"path": "index.md", "role": "entrypoint"},
    {"path": "principles.md", "role": "principles"}
  ],
  "source_ids": ["S001", "S002"],
  "validation": {"status": "passed", "tool": "kd_asset_validate.py"}
}
```

## Common Entry Template

Use one `KA-####` id per durable knowledge entry. Do not reuse ids for unrelated ideas.

```markdown
## KA-0001: [Title]

- Type: anchor | principle | mechanism | playbook-pattern | factor-seed | concept | evidence | conflict | query | open-question
- Layer: L0 | L1 | L2 | L3 | L4 | L5
- Status: active | tentative | contested | refined | superseded
- Grounding: strong | medium | weak | single-source | contested
- Confidence: verbatim | artifact | inference
- Temporal Scope: timeless | period-specific | dated | unknown
- As-of: [source date, inferred period, or unknown]
- Currentness: current | likely-current | possibly-outdated | outdated | needs-verification
- External Check: source-only | llm-prior | current-source-needed | user-provided-update
- Sources: S001, S004
- Related: supports KA-0002; bounded-by KA-0007
- Supersedes:
- Superseded by:

**Source Claim:** [What the source says.]

**Agent Assessment:** [Whether the source claim is current, outdated, incomplete, context-bound, or needs verification.]

**Corrected / Supplemented Claim:** [The durable version to use. If no correction was needed, this may match the source claim.]

**Mechanism:** [Why it works, what causes it, or what structure it reveals.]

**Boundary:** [Where it fails, does not apply, or needs caution.]

**Evidence:** [Short source-backed evidence with source ids and chunk ids when useful.]

**Audit Note:** [Any change from source wording, LLM supplementation, currentness warning, or verification gap.]

**Usage:** [How a future agent should use this asset.]

**Notes:** [Preserved nuance, variants, or uncertainty.]
```

## File Templates

### `index.md`

```markdown
# [Corpus] Knowledge Assets

## Scope
- Corpus:
- Source pack:
- Profiles:
- Generated:
- Last validated:

## Start Here
- Philosophy / anchors:
- Mechanisms:
- Playbook:
- Factor seeds:
- Concept map:
- Evidence:
- Conflicts:
- Currentness ledger:

## Retrieval Notes
[Where future agents should look first for common question types.]

## Update Notes
[What changed in the latest distillation pass.]
```

### `core-anchors.md`

Use `Type: anchor`, `Layer: L5`. Anchors must be memorable handles backed by a full principle and evidence. Never keep a slogan without mechanism and boundary.

### `principles.md`

Use `Type: principle`, `Layer: L4`. Each principle needs a transfer condition, boundary, evidence, and at least one concrete example or counterexample when available.

### `mechanisms.md`

Use `Type: mechanism`, `Layer: L3`. Explain causal, behavioral, organizational, or market logic. Mechanisms are the bridge from evidence to principles and factor seeds.

### `playbook.md`

Use `Type: playbook-pattern`, usually `Layer: L2`. Include trigger, context, action, checks, risks, examples, and failure modes.

### `factor-seeds.md`

Use `Type: factor-seed`, usually `Layer: L2-L3`. Include hypothesis, mechanism, observable proxy, data need, test shape, refutation condition, and caveats. Label all seeds as hypotheses.

### `concept-map.md`

Include two tables:

```markdown
## Concepts
| Asset ID | Concept | Layer | Sources | Status | Notes |

## Relations
| From | Relation | To | Evidence | Notes |
```

Relations should use stable verbs such as `supports`, `contradicts`, `refines`, `bounds`, `exemplifies`, `operationalizes`, or `evolves-into`.

### `evidence-index.md`

Support both lookup directions:

```markdown
## Claim to Source
| Asset ID | Claim | Sources | Chunk / location | Evidence type |

## Source to Claim
| Source | Chunk / location | Asset IDs | Notes |
```

### `conflicts.md`

Contradictions are assets, not defects. Use `Type: conflict` with `Status: contested`; record both sides, source ids, possible reconciliation, and what remains unresolved.

### `currentness-ledger.md`

Required when any asset is corrected, narrowed, or supplemented by LLM judgment, or when old/time-sensitive source claims are marked as dated or needing verification.

```markdown
# Currentness Ledger

| Asset ID | Source Claim | Source Period | Currentness | Agent Intervention | Basis | Action |
|---|---|---|---|---|---|---|
```

Do not hide LLM corrections inside the asset wording only. The ledger is the audit trail for source-led but not source-worship distillation.

### `saved-queries.md`

Store reusable question patterns for future agents:

```markdown
## KA-0101: [Query Name]
- Type: query
- Status: active
- Sources:
- Related:

**Question:** [Reusable query.]
**Search path:** [Files and asset ids to inspect.]
**Answer shape:** [Expected response structure.]
```

### `answer-protocol.md`

This file should link to `retrieval-and-answering.md` and record corpus-specific retrieval shortcuts.
