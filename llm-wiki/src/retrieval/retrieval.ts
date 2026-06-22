import { embeddingCachePath, loadEmbeddingCache } from './embedding-cache.js'
import { createEmbeddingProvider, loadEmbeddingProviderConfigFromEnv } from './embedding-provider.js'
import { embeddingModelMetaDiagnostics, embeddingQueryVectorDimensionDiagnostics } from './embedding-meta.js'
import { buildCitation } from './citations.js'
import { scoreRetrievalConfidence } from './confidence.js'
import { evidenceBudgetForChunkCount, type EvidenceBudget } from './context-budget.js'
import { scoreEntityGraphBoosts } from './entity-graph.js'
import { fuseLexicalScoresWithRrf, generateQueryExpansions } from './expansion.js'
import { scoreGraphBoosts } from './graph.js'
import { scoreHybrid } from './hybrid.js'
import { generateHydeDocument } from './hyde.js'
import { loadRetrievalIndex } from './index-store.js'
import { scoreLexical } from './lexical.js'
import { decideQueryCoverage, filterRetrievableChunks, lexicalSeedsForExpansion, pruneWeakGraphBoosts } from './policy.js'
import { rerankHybridEntries } from './rerank.js'
import { scoreTaxonomyBoosts } from './taxonomy.js'
import { tokenize } from './tokenize.js'
import type { RetrievalHit, RetrievalResult, RetrievalSignalSummary, RetrieveChunksInput } from './types.js'

const OVERVIEW_PATTERNS = [
  /summari[sz]e\s+what\s+has\s+been\s+(?:ingested|indexed|imported)/i,
  /what\s+has\s+been\s+(?:ingested|indexed|imported)/i,
  /what\s+was\s+(?:ingested|indexed|imported)/i,
  /\boverview\b/i,
  /what\s+is\s+in\s+the\s+wiki/i,
] as const

export async function retrieveChunks(input: RetrieveChunksInput): Promise<RetrievalResult> {
  const store = await loadRetrievalIndex(input.knowledgeRoot)
  if (!store) {
    return buildRetrievalResult({
      mode: 'fallback',
      hits: [],
      diagnostics: ['retrieval index missing or older than chunks v2 / lexical v1'],
    })
  }

  if (store.readinessDiagnostics.length > 0) {
    return buildRetrievalResult({
      mode: 'stale-index',
      hits: [],
      diagnostics: store.readinessDiagnostics,
    })
  }

  const diagnostics: string[] = []
  const { chunks, filtered } = filterRetrievableChunks(store.chunks, Boolean(input.includeReview))
  const evidenceBudget = evidenceBudgetForChunkCount(chunks.length, input.limit)
  const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]))
  if (filtered.review > 0) {
    diagnostics.push(`review/proposal chunks excluded by default: ${filtered.review}`)
  }
  if (filtered.sensitive > 0) {
    diagnostics.push(`private/sensitive chunks excluded by default: ${filtered.sensitive}`)
  }
  const queryTokens = tokenize(input.question)
  const originalLexicalScores = scoreLexical({ queryTokens, lexical: store.lexical, chunksById })
  const expandedQueries = await generateQueryExpansions({ knowledgeRoot: input.knowledgeRoot, question: input.question, diagnostics })
  const expandedLexicalScores = expandedQueries.map((query) => ({
    query,
    scores: scoreLexical({ queryTokens: tokenize(query), lexical: store.lexical, chunksById }),
  }))
  const lexicalScores = fuseLexicalScoresWithRrf({ original: originalLexicalScores, expanded: expandedLexicalScores })
  if (expandedLexicalScores.length > 0) {
    diagnostics.push(`query expansion fused lexical rankings with RRF from ${expandedLexicalScores.length} variant(s)`)
  }
  const expansionSeeds = lexicalSeedsForExpansion(lexicalScores, queryTokens)
  const linkGraphBoosts = scoreGraphBoosts({ chunks, graph: store.graph, lexicalScores: expansionSeeds })
  const entityGraphBoosts = scoreEntityGraphBoosts({ chunks, graph: store.entityGraph, queryTokens, lexicalScores: expansionSeeds })
  const graphBoosts = pruneWeakGraphBoosts(mergeGraphBoosts(linkGraphBoosts, entityGraphBoosts), expansionSeeds)
  const taxonomyBoosts = scoreTaxonomyBoosts({ chunks, taxonomy: store.taxonomy, queryTokens })
  const embedding = await loadQueryEmbeddingIfAvailable(input.knowledgeRoot, input.question, diagnostics, {
    disableHyde: Boolean(input.disableHyde),
  })
  const scored = scoreHybrid({
    chunks,
    lexicalScores,
    embeddingRecords: embedding.records,
    queryVector: embedding.queryVector,
    providerConfig: embedding.config,
    graphBoosts,
    taxonomyBoosts,
  })
  const limit = evidenceBudget.citationLimit
  const allowedEntries = scored
    .filter((entry) => entry.total > 0)
    .map((entry) => ({ entry, coverage: decideQueryCoverage(entry, queryTokens) }))
    .filter(({ coverage }) => coverage.allowed)
  const rerankedEntries = await rerankHybridEntries({
    question: input.question,
    entries: allowedEntries.map(({ entry }) => entry),
    limit,
    diagnostics,
  })
  const coverageByChunkId = new Map(allowedEntries.map(({ entry, coverage }) => [entry.chunk.chunkId, coverage]))
  const hits = rerankedEntries
    .slice(0, limit)
    .map((entry) => ({
      chunk: entry.chunk,
      score: {
        lexical: entry.lexical,
        embedding: entry.embedding,
        graph: entry.graph,
        taxonomy: entry.taxonomy,
        metadata: entry.metadata,
        rerank: entry.rerank,
        total: entry.total,
      },
      reasons: [...entry.reasons, `coverage:${coverageByChunkId.get(entry.chunk.chunkId)?.reason ?? 'unknown'}`],
      citation: buildCitation(entry.chunk),
    }))

  if (hits.length > 0) {
    return buildRetrievalResult({ mode: 'matched', hits, diagnostics, evidenceBudget })
  }

  if (isOverviewQuestion(input.question)) {
    const overviewHits = chunks
      .filter((chunk) => chunk.metadata.section === 'sources')
      .slice(0, limit)
      .map((chunk) => ({
        chunk,
        score: { lexical: 0, embedding: 0, graph: 0, taxonomy: 0, metadata: 0, rerank: 0, total: 0 },
        reasons: ['overview:fallback'],
        citation: buildCitation(chunk),
      }))
    return buildRetrievalResult({ mode: overviewHits.length > 0 ? 'overview' : 'no-match', hits: overviewHits, diagnostics, evidenceBudget })
  }

  return buildRetrievalResult({ mode: 'no-match', hits: [], diagnostics, evidenceBudget })
}

function mergeGraphBoosts(
  left: Map<string, { score: number; reasons: string[] }>,
  right: Map<string, { score: number; reasons: string[] }>,
): Map<string, { score: number; reasons: string[] }> {
  const merged = new Map<string, { score: number; reasons: string[] }>()
  for (const [chunkId, boost] of [...left.entries(), ...right.entries()]) {
    const current = merged.get(chunkId) ?? { score: 0, reasons: [] }
    current.score += boost.score
    current.reasons.push(...boost.reasons)
    merged.set(chunkId, {
      score: Number(Math.min(current.score, 0.3).toFixed(6)),
      reasons: [...new Set(current.reasons)].sort(),
    })
  }
  return merged
}

function buildRetrievalResult(input: {
  mode: RetrievalResult['mode']
  hits: RetrievalHit[]
  diagnostics: string[]
  evidenceBudget?: EvidenceBudget
}): RetrievalResult {
  const signalSummary = buildSignalSummary(input.mode, input.hits, input.evidenceBudget ?? evidenceBudgetForChunkCount(0))
  const diagnostics = [...input.diagnostics]
  if (signalSummary.confidence.lowConfidence && input.mode === 'matched') {
    diagnostics.push(`retrieval confidence low: score=${signalSummary.confidence.score}; reasons=${signalSummary.confidence.reasons.join(',')}`)
  }
  return {
    ...input,
    diagnostics,
    signalSummary,
  }
}

function buildSignalSummary(mode: RetrievalResult['mode'], hits: RetrievalHit[], evidenceBudget: EvidenceBudget): RetrievalSignalSummary {
  return {
    mode,
    hitCount: hits.length,
    citationCount: hits.length,
    evidenceBudget,
    confidence: scoreRetrievalConfidence(mode, hits),
    signalCounts: {
      lexical: hits.filter((hit) => hit.score.lexical > 0).length,
      embedding: hits.filter((hit) => hit.score.embedding > 0).length,
      graph: hits.filter((hit) => hit.score.graph > 0).length,
      taxonomy: hits.filter((hit) => hit.score.taxonomy > 0).length,
      metadata: hits.filter((hit) => hit.score.metadata > 0).length,
      rerank: hits.filter((hit) => hit.score.rerank > 0).length,
      overviewFallback: hits.filter((hit) => hit.reasons.includes('overview:fallback')).length,
    },
    sourceCounts: {
      rawEvidence: hits.filter((hit) => hit.chunk.rawPath).length,
      wikiDerived: hits.filter((hit) => !hit.chunk.rawPath).length,
    },
  }
}

async function loadQueryEmbeddingIfAvailable(
  knowledgeRoot: string,
  question: string,
  diagnostics: string[],
  options: { disableHyde?: boolean } = {},
): Promise<{
  config: ReturnType<typeof loadEmbeddingProviderConfigFromEnv>
  queryVector: number[] | null
  records: Map<string, Awaited<ReturnType<typeof loadEmbeddingCache>>['records'][number]>
}> {
  const config = loadEmbeddingProviderConfigFromEnv()
  if (!config) {
    diagnostics.push('embedding provider not configured; using lexical retrieval only')
    return { config: null, queryVector: null, records: new Map() }
  }

  diagnostics.push(...await embeddingModelMetaDiagnostics(knowledgeRoot, config))
  const cache = await loadEmbeddingCache(embeddingCachePath(knowledgeRoot, config))
  if (cache.records.length === 0) {
    diagnostics.push('embedding cache missing or empty; using lexical retrieval only')
    return { config, queryVector: null, records: new Map() }
  }

  try {
    const provider = createEmbeddingProvider(config)
    const hydeDocument = options.disableHyde
      ? null
      : await generateHydeDocument({ question, diagnostics })
    if (options.disableHyde) {
      diagnostics.push('hyde disabled by query option; embedding raw question')
    }
    const queryVector = await provider.embed({ text: hydeDocument ?? question })
    const dimensionDiagnostics = await embeddingQueryVectorDimensionDiagnostics(knowledgeRoot, config, {
      queryVectorDims: queryVector.length,
      records: cache.records,
    })
    if (dimensionDiagnostics.length > 0) {
      diagnostics.push(...dimensionDiagnostics)
      diagnostics.push('embedding query vector dimension mismatch; using lexical retrieval only')
      return { config, queryVector: null, records: new Map() }
    }
    return { config, queryVector, records: cache.recordsByCacheKey }
  } catch (error) {
    diagnostics.push(`query embedding unavailable; using lexical retrieval only: ${(error as Error).message}`)
    return { config, queryVector: null, records: new Map() }
  }
}

function isOverviewQuestion(question: string): boolean {
  return OVERVIEW_PATTERNS.some((pattern) => pattern.test(question.trim()))
}
