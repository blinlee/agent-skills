# Embedding Provider Reference

Embedding is optional host-local retrieval substrate. It improves semantic recall but never replaces chunk evidence, lexical retrieval, governance filters, or citations.

## Recommended local provider: Ollama

```bash
export LLM_WIKI_EMBEDDING_PROVIDER=ollama
export LLM_WIKI_EMBEDDING_ENDPOINT=http://127.0.0.1:11434/api/embed
export LLM_WIKI_EMBEDDING_MODEL=bge-m3
```

Optional:

```bash
export LLM_WIKI_EMBEDDING_DIMENSIONS=1024
export LLM_WIKI_EMBEDDING_TIMEOUT_MS=30000
export LLM_WIKI_EMBEDDING_CONCURRENCY=4
export LLM_WIKI_EMBEDDING_BATCH_SIZE=16
```

Other providers:

- `local-http`
- `ollama`
- `lm-studio`
- `custom-endpoint`

Wire formats:

- `ollama-embed`
- `ollama-embeddings`
- `openai-compatible`

## Build embedding cache

```bash
npm run --silent cli -- index <knowledgeRoot>
npm run --silent cli -- embed-index <knowledgeRoot>
```

Cache location:

```text
system/index/embeddings/<provider>-<model>/vectors.db
```

Record key:

```text
provider:model:textSha256
```

This means same chunk text is reused, changed text is recomputed, and stale records are pruned. Cache is rebuildable; Markdown wiki remains canonical knowledge.

## Three-part verification

Do not say embedding influenced an answer merely because `embed-index` succeeded. Verify:

1. `vectors.db` has valid records for the configured provider/model, and `model_meta.json` matches the configured model and dimensions.
2. query diagnostics do not include cache/provider/query-vector degradation.
3. query result shows an embedding signal:
   - single wiki: `retrieval.signalSummary.signalCounts.embedding > 0`
   - registry: `agentReadingPack.embeddingUsed === true`

If embedding is not configured or not usable, query still degrades to lexical + graph/taxonomy + metadata retrieval.

## Provider cache gotcha

Cache loader must accept every supported provider name (`local-http`, `ollama`, `lm-studio`, `custom-endpoint`). If query says many embedding cache lines are invalid after a successful `embed-index`, inspect provider-name validation first.

## HyDE

HyDE is an optional embedding-side query enhancement. It is enabled only when host-local config or environment variables provide an endpoint.

```bash
export LLM_WIKI_HYDE_ENDPOINT=http://127.0.0.1:8001/hyde
export LLM_WIKI_HYDE_MODEL=local-chat
```

Behavior:

- HyDE runs only after the embedding provider and embedding cache are usable.
- The endpoint receives the original question and returns generated text.
- Generated text is embedded in place of the raw question.
- Lexical retrieval still uses the original question.
- `query <knowledgeRoot> <question> --no-hyde` disables HyDE for debugging.
- Empty, unavailable, timed-out, or malformed responses fall back to embedding the raw question.
- HyDE output is a retrieval direction signal, not wiki evidence or answer content.

## Rerank

Rerank is optional local retrieval substrate enabled by `LLM_WIKI_RERANK_ENDPOINT`.

```bash
export LLM_WIKI_RERANK_ENDPOINT=http://127.0.0.1:8000/rerank
export LLM_WIKI_RERANK_MODEL=bge-reranker-v2-m3
```

The runtime first scores candidates through lexical, embedding, graph, taxonomy, and metadata signals. It then sends top candidates to the rerank endpoint. The endpoint may return `scores: number[]` or indexed result objects such as `{ "index": 0, "score": 0.8 }`.

If rerank is unavailable or malformed, query falls back to the original hybrid order. Registry query can also rerank the fused cross-wiki source-backed citation pool before final source-pack selection.

## Query Expansion

Query expansion is opt-in through host-local config or `LLM_WIKI_EXPANSION_ENDPOINT`.

When configured, query uses generated variants for lexical retrieval only, fuses original/expanded BM25 rankings with reciprocal rank fusion, then continues through normal hybrid scoring and rerank. If no endpoint is configured, root-local `system/index/domain-synonyms.json` can provide a zero-call fallback dictionary.

## Entity, Key Info, And Overview

Entity/relation extraction:

```bash
npm run --silent cli -- ingest <knowledgeRoot> <source> --quality <quality.json> --curation <curation.json> --extract-entities
```

Requires host-local config or `LLM_WIKI_ENTITY_ENDPOINT`. This is a retrieval substrate only: extracted entity/relation JSON is written to `system/index/entity-extractions.json`; `index` folds extracted entity keys into `entity-graph.json` and lexical retrieval text. It does not create public `wiki/entities` pages; public semantic pages require accepted quality and curation plans.

Key info extraction:

```bash
npm run --silent cli -- ingest <knowledgeRoot> <source> --extract-key-info
```

Requires host-local config or `LLM_WIKI_KEY_INFO_ENDPOINT`. It writes structured `summary`, `key_claims`, `methodology`, `evidence`, `limitations`, `relations`, and `open_questions` to `system/index/key-info.json`. Only chunk-scoped key-info records participate in lexical retrieval and citation excerpts; page-level key-info remains derived context.

Overview:

```bash
npm run --silent cli -- wiki-overview <knowledgeRoot>
```

Writes `system/index/wiki-overview.md`. Query exposes it as a context layer. If host-local config or `LLM_WIKI_OVERVIEW_ENDPOINT` is configured, the overview can be LLM-synthesized with provenance/freshness metadata; otherwise it is deterministic.

## Confidence Threshold

Retrieval confidence defaults to `0.35`. Advanced operators may override it:

```bash
export LLM_WIKI_CONFIDENCE_THRESHOLD=0.35
```

Use values in `0..1`. Treat confidence as retrieval diagnostics, not approval.
