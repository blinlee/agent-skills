import type { ChunkIndexEntryV2 } from './types.js'

export type CoverageDecision = {
  allowed: boolean
  reason: 'short-query' | 'semantic-signal' | 'lexical-coverage' | 'insufficient-lexical-coverage'
  metrics: {
    uniqueQueryTokenCount: number
    matchedTermCount: number
    hasEmbedding: boolean
    hasGraph: boolean
    hasTaxonomy: boolean
  }
}

export type RetrievalSignalForCoverage = {
  lexicalTerms: string[]
  embedding: number
  graph: number
  taxonomy: number
}

export type GraphBoost = { score: number; reasons: string[] }

export function lexicalSeedsForExpansion(
  lexicalScores: Map<string, { score: number; terms: string[] }>,
  queryTokens: string[],
): Map<string, { score: number; terms: string[] }> {
  const uniqueQueryTokenCount = new Set(queryTokens).size
  if (uniqueQueryTokenCount < 3) {
    return lexicalScores
  }

  const result = new Map<string, { score: number; terms: string[] }>()
  for (const [chunkId, score] of lexicalScores.entries()) {
    if (new Set(score.terms).size >= 2) {
      result.set(chunkId, score)
    }
  }
  return result
}

export function decideQueryCoverage(entry: RetrievalSignalForCoverage, queryTokens: string[]): CoverageDecision {
  const uniqueQueryTokens = new Set(queryTokens)
  const matchedTermCount = new Set(entry.lexicalTerms).size
  const metrics = {
    uniqueQueryTokenCount: uniqueQueryTokens.size,
    matchedTermCount,
    hasEmbedding: entry.embedding > 0,
    hasGraph: entry.graph > 0,
    hasTaxonomy: entry.taxonomy > 0,
  }

  if (uniqueQueryTokens.size < 3) {
    return { allowed: true, reason: 'short-query', metrics }
  }
  if (metrics.hasEmbedding) {
    return { allowed: true, reason: 'semantic-signal', metrics }
  }
  if (matchedTermCount >= 2) {
    return { allowed: true, reason: 'lexical-coverage', metrics }
  }
  if (matchedTermCount >= 1 && (metrics.hasGraph || metrics.hasTaxonomy)) {
    return { allowed: true, reason: 'semantic-signal', metrics }
  }
  return { allowed: false, reason: 'insufficient-lexical-coverage', metrics }
}

export function pruneWeakGraphBoosts(
  boosts: Map<string, GraphBoost>,
  lexicalScores: Map<string, { score: number; terms: string[] }>,
): Map<string, GraphBoost> {
  const result = new Map<string, GraphBoost>()
  for (const [chunkId, boost] of boosts.entries()) {
    if (lexicalScores.get(chunkId)?.score) {
      result.set(chunkId, boost)
      continue
    }
    const hasStrongReason = boost.reasons.some((reason) => reason.startsWith('graph:') || reason.includes('page-link') || reason.includes('topic-related'))
    if (hasStrongReason || boost.score >= 0.045) {
      result.set(chunkId, boost)
    }
  }
  return result
}

export function filterRetrievableChunks(chunks: ChunkIndexEntryV2[], includeReview: boolean): {
  chunks: ChunkIndexEntryV2[]
  filtered: { review: number; sensitive: number }
} {
  const filtered = { review: 0, sensitive: 0 }
  const allowed = chunks.filter((chunk) => {
    if (!includeReview && !isDefaultReviewRetrievableChunk(chunk)) {
      filtered.review += 1
      return false
    }
    if (isSensitiveChunk(chunk)) {
      filtered.sensitive += 1
      return false
    }
    return true
  })
  return { chunks: allowed, filtered }
}

function isDefaultReviewRetrievableChunk(chunk: { filePath: string; pageTarget: string }): boolean {
  const normalizedPath = chunk.filePath.replaceAll('\\', '/')
  const normalizedTarget = chunk.pageTarget.replaceAll('\\', '/')
  return !normalizedPath.includes('/review/')
    && !normalizedPath.includes('/taxonomy/proposals/')
    && !normalizedPath.includes('/taxonomy/evidence-proposals/')
    && !normalizedTarget.startsWith('review/')
    && !normalizedTarget.startsWith('taxonomy/proposals/')
    && !normalizedTarget.startsWith('taxonomy/evidence-proposals/')
}

function isSensitiveChunk(chunk: { filePath: string; sourceRef: string | null; metadata: { privacy?: string; sensitive?: boolean } }): boolean {
  const privacy = chunk.metadata.privacy?.toLowerCase()
  if (privacy === 'private' || privacy === 'sensitive' || chunk.metadata.sensitive === true) {
    return true
  }
  const haystack = `${chunk.filePath}\n${chunk.sourceRef ?? ''}`.replaceAll('\\', '/').toLowerCase()
  return haystack.includes('/private/') || haystack.includes('/secrets/') || haystack.includes('/sensitive/')
}
