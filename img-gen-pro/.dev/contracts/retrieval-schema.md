# Retrieval Schema

This repo uses `references/` as the canonical template surface and `data/retrieval-index.json` as the retrieval-intelligence source.

## Purpose
The retrieval schema narrows fuzzy user intent into a small set of candidate canonical templates without hard-casting retrieval metadata into canonical prompt JSON.

## Canonical fields
- `categories[]`: normalized category records
- `styles[]`: normalized style vocab + keywords from the retrieval index
- `scenes[]`: normalized scene vocab + keywords from the retrieval index
- `templates[]`: retrieval records derived from the retrieval index template metadata

## Template retrieval record
Each retrieval record may contain:
- `id`
- `title`
- `category`
- `styles[]`
- `scenes[]`
- `tags[]`
- `useWhen`
- `guidance`
- `pitfalls`
- `exampleCases[]`
- `templateSource.anchor`
- `canonicalTargets[]`
- `mappingConfidence`

## Guardrails
- Canonical templates in `references/` remain the user-facing template authority.
- The retrieval index remains a taxonomy/case/reference source.
- Matching is `category -> style -> scene -> exampleCases`.
- `canonicalTargets[]` are candidate landing templates, not proof of schema equivalence.
