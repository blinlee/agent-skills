# RAG Query Workflow

Use this reference when the user invokes `/llm-wiki query` or asks an llm-wiki root/atlas a question.

## Hard rule

Run retrieval before answering. Do not answer `/llm-wiki query` from source inspection, README reading, implementation memory, or architecture explanation alone.

## Deterministic handoff

From the package root:

```bash
python3 scripts/query_handoff.py "<question>" --json
```

Then run the returned `recommendedCommand` exactly:

```bash
npm run --silent cli -- query <knowledgeRoot> "<question>"
npm run --silent cli -- query-registry <registryRoot> "<question>"
```

Use `--root <path>` on the helper only when the user supplied an explicit root.

The default command output is the agent-facing reading pack wrapper:

- `question`
- `answerability`
- `readiness`
- `sourceReadingPack`

Answer from `sourceReadingPack.passages[]`. When `sourceReadingPack.readingMode === "document"`, treat `sourceReadingPack.documents[]` as the concise original-document reading list and use the paired entry passages as the starting points. Run the same query with `--full` only when you need complete citations, diagnostics, `agentReadingPack`, per-wiki reading packs, or score details.

## Interpret result

Single-wiki query:

- Default output `answerability === "answered"` plus `sourceReadingPack.passages.length > 0`: answer from those passages.
- Default output `answerability === "insufficient-evidence"` or `passages.length === 0`: say the wiki did not return enough source-backed evidence; do not synthesize.
- If you need to explain why, rerun with `--full` and inspect `retrieval.mode`, `grounding.answerability`, citations, and diagnostics.
- In `--full`, `retrieval.mode === "no-match"` means no evidence matched, `overview` is collection overview only, and `fallback`/`stale-index` means retrieval substrate repair is needed before factual answering.

Registry query:

- Default output uses the same `sourceReadingPack.passages[]` evidence contract.
- Survey/framework/route questions may return `sourceReadingPack.readingMode === "document"` with `documents[]`. That list is not a score ledger; it identifies the original raw documents an agent should read when full-document synthesis is needed.
- Registry default passages should be raw-backed original-source passages. If no raw-backed evidence qualifies, the default pack should be empty/insufficient rather than falling back to derived wiki excerpts.
- Use `--full` to inspect `selectedWikis`, `agentReadingPack.searchedWikis`, `agentReadingPack.citationsToRead`, `diagnostics.embeddingDegradedWikis`, raw-backed/derived citation counts, and per-wiki packs.

## Embedding verification

`embed-index` success is not proof query used embedding. Verify all three when claiming semantic retrieval:

1. cache records exist and are valid for configured provider/model.
2. query diagnostics do not say cache empty/unavailable or query embedding unavailable.
3. In default output, answer only from source passages. To prove embedding contributed, rerun with `--full` and check `retrieval.signalSummary.signalCounts.embedding > 0` or registry `agentReadingPack.embeddingUsed === true`.

Recommended Ollama env:

```bash
export LLM_WIKI_EMBEDDING_PROVIDER=ollama
export LLM_WIKI_EMBEDDING_ENDPOINT=http://127.0.0.1:11434/api/embed
export LLM_WIKI_EMBEDDING_MODEL=bge-m3
```

## Deep-reading rule

A query answer is an evidence/navigation pack. For important claims, inspect the default passage metadata: `rawPath`, `sourceRef`, `heading`, `startLine`, `endLine`, and `stitchedFromChunkIds`. For survey questions, inspect `documents[]` first and read the listed raw files when the answer requires full-paper synthesis rather than a few local facts. Use `--full` when you need lower-level citation or score diagnostics.

## Save-synthesis gate

Only run `save-synthesis` after all are true:

1. query returned source-backed passages.
2. default `answerability` is `answered` or full `grounding.answerability` is `answered`.
3. answer is worth durable wiki write-back.
4. user explicitly approved promotion.

Never promote no-match, overview-only, fallback-only, or insufficient-evidence runs.
