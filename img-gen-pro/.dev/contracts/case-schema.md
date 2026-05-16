# Case Schema

This repo stores only the curated case subset needed for disambiguation, ranking, and prompt-standardization support.

## Source
- Canonical data source: `data/case-index.json`
- Selection seed: `data/retrieval-index.json` `templates[*].exampleCases[]`

## Curated case record
- `id`
- `title`
- `category`
- `styles[]`
- `scenes[]`
- `featured`
- `promptPreview`
- `prompt`
- `sourceLabel`
- `sourceUrl`
- `githubUrl`
- `linkedTemplateIds[]`

## Selection rule
Phase 1 keeps the example-case subset referenced directly by template metadata.

## Guardrails
- Cases are retrieval evidence, not a gallery product.
- Cases must link back to one or more retrieval template IDs.
- Expanding beyond the referenced subset requires deliberate review.
