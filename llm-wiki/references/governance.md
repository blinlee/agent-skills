# llm-wiki governance reference

Load this reference when working on raw integrity, review policy, classification, lint/audit behavior, or the five known llm-wiki risk critiques.

## Layer contract

```text
raw/inbox -> raw/objects + intake ledger -> sharded raw/staged/raw/archive -> review/taxonomy proposals -> accepted wiki/taxonomy
```

- `raw/inbox/`: short-lived user dropzone; not canonical generated knowledge and not a historical archive.
- `raw/objects/`: sharded content-addressed atlas original store. Scheduled agents should use `system/intake/items/`, not scan this tree for pending work.
- `raw/staged/` and `raw/archive/`: sharded managed immutable evidence. Files include sha256 frontmatter over the body and are recorded in `system/manifests/raw-sources.json`.
- `wiki/`: Obsidian-compatible generated pages, index, log, sources, entities, concepts, syntheses.
- `review/`: low-confidence, conflict, merge-candidate, and synthesis promotion queues.
- `taxonomy/`: proposal and accepted classification state.
- `system/`: jobs, dedup, raw manifests, adapters, cache.

## Five risk controls

1. **Errors can harden**: keep weak/conflicting knowledge in review; use git history and lint warnings; do not silently canonicalize uncertain claims.
2. **Hallucinations can look trustworthy**: require citations/evidence, confidence, contested flags, qualified links, and lint validation.
3. **Summaries lose information**: preserve raw, source excerpts, verbatim evidence samples, caveats, and edge-case signals.
4. **Wiki alone does not scale forever**: use query/search/RAG-style retrieval at larger sizes; heed lint warnings for large sections, 100+ pages, and missing topic maps.
5. **A prompt wiki is not a full wiki**: keep proposal status, reviewer identity, timestamps, rationale, evidence, and rollback-friendly git history.

## Review-gated classification

Model output may propose:

- source domain/category
- topic/tag/taxonomy placement
- target folder or page section
- entity/concept assignment
- merge/backlink candidate

It must not become canonical taxonomy or durable placement without explicit approval or edit. Unreviewed classification can support temporary routing, daily briefs, and review queues only.

Classification proposals should separate:

- **profile boundary**: which wiki/concept scheme owns the source;
- **category path**: curated broader/narrower placement inside the owner wiki;
- **facet tags**: controlled multi-axis labels for search/filtering;
- **semantic links**: related concepts, evidence trails, contrasts, dependencies, and cross-wiki bridges.

## Query promotion and backlinks

Query answers are working analysis until promoted. A `save-synthesis` promotion should be reserved for answers that add durable retrieval value:

- cross-source insight, comparison, conflict analysis, concept unification, or reusable method summary
- citations that cover the claim rather than merely decorating it
- novelty beyond a transient chat answer or single-source paraphrase
- clear enough scope that future agents will retrieve it as knowledge rather than management chatter
- explicit human approval before the durable write

Backlink policy follows the same proposal-first boundary. Ingest should not repair backlinks or scan the wiki for semantic link opportunities. That work belongs to explicit graph-health surfaces: lint, index, bridge-index, accepted bridge/taxonomy operations, or confirmed synthesis promotion.

Confirmed promotion may add narrow backlinks to cited/related pages because the human has approved the synthesis as durable knowledge. Broad backlink repair for large roots should be delayed to lint/index or a dedicated review pass.

## Repair guidance

- Broken wikilink: fix generated wiki link or index entry, then rerun `lint`.
- Raw drift: do not edit raw to silence lint. Investigate whether raw was mutated; preserve evidence and repair downstream pages or re-ingest a new source version.
- Low-confidence/contested page: route to review or update confidence/contested state with evidence.
- Oversized page: split into smaller durable pages and maintain qualified backlinks.
