import { tokenCounts } from './tokenize.js'
import type { ChunkIndexEntryV2, LexicalIndexState } from './types.js'

export function buildLexicalIndex(input: {
  knowledgeRoot: string
  generatedAt: string
  chunks: ChunkIndexEntryV2[]
  supplementalTextsByChunkId?: Map<string, string>
}): LexicalIndexState {
  const termPostings = new Map<string, Map<string, number>>()
  let totalTokens = 0

  for (const chunk of input.chunks) {
    const supplementalText = input.supplementalTextsByChunkId?.get(chunk.chunkId) ?? ''
    const counts = tokenCounts(`${chunk.pageTitle} ${chunk.headingPath.join(' ')} ${chunk.text} ${supplementalText}`)
    totalTokens += chunk.tokenCountApprox
    for (const [term, tf] of Object.entries(counts)) {
      const postings = termPostings.get(term) ?? new Map<string, number>()
      postings.set(chunk.chunkId, tf)
      termPostings.set(term, postings)
    }
  }

  const terms: LexicalIndexState['terms'] = {}
  for (const [term, postings] of [...termPostings.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    terms[term] = {
      df: postings.size,
      postings: [...postings.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([chunkId, tf]) => ({ chunkId, tf })),
    }
  }

  return {
    version: 1,
    schema: 'llm-wiki.lexical.v1',
    knowledgeRoot: input.knowledgeRoot,
    generatedAt: input.generatedAt,
    chunkIndexVersion: 2,
    chunkCount: input.chunks.length,
    avgChunkTokens: input.chunks.length > 0 ? totalTokens / input.chunks.length : 0,
    terms,
  }
}

export function scoreLexical(input: {
  queryTokens: string[]
  lexical: LexicalIndexState
  chunksById: Map<string, ChunkIndexEntryV2>
}): Map<string, { score: number; terms: string[] }> {
  const scores = new Map<string, { score: number; terms: string[] }>()
  const uniqueQueryTokens = [...new Set(input.queryTokens)]
  const chunkCount = Math.max(1, input.lexical.chunkCount)
  const avgLength = Math.max(1, input.lexical.avgChunkTokens || 1)
  const k1 = 1.2
  const b = 0.75

  for (const token of uniqueQueryTokens) {
    const term = input.lexical.terms[token]
    if (!term) {
      continue
    }
    const idf = Math.log(1 + (chunkCount - term.df + 0.5) / (term.df + 0.5))
    for (const posting of term.postings) {
      const chunk = input.chunksById.get(posting.chunkId)
      if (!chunk) {
        continue
      }
      const length = Math.max(1, chunk.tokenCountApprox)
      const bm25 = idf * ((posting.tf * (k1 + 1)) / (posting.tf + k1 * (1 - b + b * (length / avgLength))))
      const titleHeadingBoost = headingOrTitleContains(chunk, token) ? 0.25 : 0
      const current = scores.get(posting.chunkId) ?? { score: 0, terms: [] }
      current.score += bm25 + titleHeadingBoost
      current.terms.push(token)
      scores.set(posting.chunkId, current)
    }
  }

  return scores
}

function headingOrTitleContains(chunk: ChunkIndexEntryV2, token: string): boolean {
  const haystack = `${chunk.pageTitle} ${chunk.headingPath.join(' ')}`.toLowerCase()
  return haystack.includes(token)
}
