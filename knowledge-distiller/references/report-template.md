# Report Templates

## Delivery Report vs Knowledge Assets

The delivery report is a run summary for humans. It is not the durable knowledge base. Reusable outputs belong under `knowledge-assets/`; this report points to them, explains scope, and records validation status.

See `knowledge-assets.md` for canonical asset layout and `asset-schemas.md` for exact reusable asset templates.

## General Distillation Report

```markdown
# [Corpus Name] Knowledge Distillation

## Profile and Scope
- Profile:
- Source root:
- Source Pack:
- Knowledge Assets:
- What this report optimizes for:
- What it does not cover:

## Run Summary

## Generated Assets
| Asset | Path | Purpose | Status |
|---|---|---|---|

## Executive Synthesis

## Evidence-Backed Details
| Claim / Concept | Layer | Evidence | Confidence |
|---|---|---|---|

## Concept Relations
| Concept | Relation | Concept | Evidence |
|---|---|---|---|

## Contradictions and Tensions

## Currentness / Context Review
| Asset ID | Source Claim | Source Period | Currentness | Agent Intervention | Basis | Action |
|---|---|---|---|---|---|---|

## Noise Review
| Fragment | Source | Decision | Reason |
|---|---|---|---|

## Compression / Fidelity Notes
- Condensed:
- Deferred:
- Preserved in appendix:
- Inference labels:

## Open Questions
```

## Asset Boundary

Do not define reusable knowledge inside the delivery report only. The report should link to durable assets by path and `KA-####` id. Exact asset entry templates live in `asset-schemas.md`.

## Trader Delivery Report

```markdown
# [Corpus Name] Trading Distillation Delivery Report

## Profile and Scope
## Generated Assets
## Executive Synthesis
## Major Findings
## Currentness / Context Review
## Noise Review
## Compression / Fidelity Notes
## Validation Result
## Next Steps
```
