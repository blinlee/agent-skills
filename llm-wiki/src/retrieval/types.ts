import type { WikiSection } from '../wiki/sections.js'
import type { EvidenceBudget } from './context-budget.js'

export type ChunkIndexEntryV2 = {
  version?: 2
  id: string
  chunkId: string
  parentSpanId?: string
  pageTarget: string
  pageTitle: string
  filePath: string
  sourceRef: string | null
  rawPath?: string | null
  artifactId?: string | null
  evidenceKind?: 'raw' | 'wiki'
  heading: string
  headingPath: string[]
  level: number
  startLine: number
  endLine: number
  startOffset?: number
  endOffset?: number
  parentStartLine?: number
  parentEndLine?: number
  parentStartOffset?: number
  parentEndOffset?: number
  chunkOrder?: number
  prevChunkId?: string | null
  nextChunkId?: string | null
  sourceBlockRefs?: string[]
  anchor: string
  text: string
  textSha256: string
  tokenCountApprox: number
  links: string[]
  metadata: {
    docType: string
    section: WikiSection
    slug: string
    sourceKind?: string
    privacy?: 'default' | 'private' | 'sensitive'
    sensitive?: boolean
  }
}

export type SourceParentSpanIndexEntry = {
  version?: 1
  parentSpanId: string
  pageTarget: string
  pageTitle: string
  filePath: string
  sourceRef: string | null
  rawPath?: string | null
  artifactId?: string | null
  evidenceKind?: 'raw' | 'wiki'
  heading: string
  headingPath: string[]
  level: number
  startLine: number
  endLine: number
  startOffset: number
  endOffset: number
  anchor: string
  text: string
  textSha256: string
  tokenCountApprox: number
  childChunkIds: string[]
  splitStrategy: 'structure' | 'window-fallback'
  sourceBlockRefs: string[]
  metadata: ChunkIndexEntryV2['metadata']
}

export type ChunkIndexStateV2 = {
  version: 2
  schema: 'llm-wiki.chunks.v2'
  chunkingSchema?: 'llm-wiki.parent-child.v1'
  knowledgeRoot: string
  generatedAt: string
  parentSpans?: SourceParentSpanIndexEntry[]
  chunks: ChunkIndexEntryV2[]
}

export type LexicalPosting = {
  chunkId: string
  tf: number
}

export type LexicalTerm = {
  df: number
  postings: LexicalPosting[]
}

export type LexicalIndexState = {
  version: 1
  schema: 'llm-wiki.lexical.v1'
  knowledgeRoot: string
  generatedAt: string
  chunkIndexVersion: 2
  chunkCount: number
  avgChunkTokens: number
  terms: Record<string, LexicalTerm>
}

export type RetrievalScore = {
  lexical: number
  embedding: number
  graph: number
  taxonomy: number
  metadata: number
  rerank: number
  total: number
}

export type RetrievalCitation = {
  chunkId: string
  pageTarget: string
  pageTitle: string
  heading: string
  headingPath: string[]
  startLine: number
  endLine: number
  sourceRef: string | null
  rawPath?: string | null
  artifactId?: string | null
  evidenceKind?: 'raw' | 'wiki'
  filePath: string
  excerpt: string
}

export type RetrievalHit = {
  chunk: ChunkIndexEntryV2
  score: RetrievalScore
  reasons: string[]
  citation: RetrievalCitation
}

export type RetrievalSignalSummary = {
  mode: 'matched' | 'overview' | 'no-match' | 'fallback' | 'stale-index'
  hitCount: number
  citationCount: number
  evidenceBudget: EvidenceBudget
  confidence: RetrievalConfidence
  signalCounts: {
    lexical: number
    embedding: number
    graph: number
    taxonomy: number
      metadata: number
      rerank: number
      overviewFallback: number
    }
  sourceCounts: {
    rawEvidence: number
    wikiDerived: number
  }
}

export type RetrievalConfidence = {
  score: number
  level: 'none' | 'low' | 'medium' | 'high'
  lowConfidence: boolean
  reasons: string[]
}

export type RetrievalResult = {
  mode: 'matched' | 'overview' | 'no-match' | 'fallback' | 'stale-index'
  hits: RetrievalHit[]
  diagnostics: string[]
  signalSummary: RetrievalSignalSummary
}

export type RetrieveChunksInput = {
  knowledgeRoot: string
  question: string
  limit?: number
  includeReview?: boolean
  disableHyde?: boolean
}
