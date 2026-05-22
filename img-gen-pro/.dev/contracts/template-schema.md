# Template Schema

Per-template markdown files in `references/` are the canonical end-user template surface.

## Canonical file shape
Each template should follow these rules:
- title
- applicability / when to use
- missing-information question order
- main prompt template（可以是 JSON，也可以是结构化模板说明；关键是它必须能被 builder 渲染成最终标准 JSON prompt string）
- parameter strategy
- auto-fill strategy
- variants
- avoid items

## Hybrid additions
A template may additionally include a small retrieval metadata block containing:
- associated template IDs
- style / scene / tag hints
- curated example-case references

## Guardrails
- Do not replace canonical prompt JSON with retrieval metadata JSON.
- Structured non-JSON templates are valid source templates, but final handoff must still be rendered as a strict JSON prompt string.
- Do not surface raw retrieval JSON as a second user-facing template authority.
- Add retrieval hints as annotations or sidecars, not as a competing template format.
