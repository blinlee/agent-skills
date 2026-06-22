import type { SourceKind } from '../types.js'

export type ContentDedupRecord = {
  docHash: string
  sourceIdentity: string
  sourceKind: SourceKind
  sourceUrl: string | null
  title: string
  normalizedTitle: string
  pageId: string
  chunkCount: number
  embeddingProvider?: string
  embeddingModel?: string
  embeddingDims?: number
  embeddingVector?: number[]
  ingestedAt: string
  updatedAt: string
}

export type ContentDedupLogEntry = {
  id: string
  newDocHash: string
  matchedDocHash: string | null
  action: 'skip' | 'record' | 'candidate' | 'pending' | 'decision' | 'merge'
  reason:
    | 'exact_hash'
    | 'semantic_0.98'
    | 'semantic_0.88'
    | 'record_success'
    | 'url_match'
    | 'title_match'
    | 'user_override'
  similarity: number | null
  sourceIdentity: string
  matchedSourceIdentity: string | null
  userDecision?: ContentDedupUserDecision
  createdAt: string
}

export type ContentDedupCandidate = {
  record: ContentDedupRecord
  reason: 'url_match' | 'title_match' | 'semantic_match'
  similarity: number | null
}

export type ContentDedupCheck = {
  docHash: string
  exactMatch: ContentDedupRecord | null
  semanticMatch: ContentDedupCandidate | null
  candidates: ContentDedupCandidate[]
}

export type ContentDedupUserDecision = 'skip' | 'update' | 'keep_both' | 'ingest'

export type ContentDedupPendingDecision = {
  id: string
  status: 'pending' | 'resolved'
  newDocHash: string
  sourceIdentity: string
  sourceKind: SourceKind
  sourceUrl: string | null
  title: string
  matchedDocHash: string
  matchedSourceIdentity: string
  matchedPageId: string
  reason: 'semantic_0.88' | 'url_match' | 'title_match'
  similarity: number | null
  userDecision?: ContentDedupUserDecision
  reviewer?: string
  note?: string
  createdAt: string
  resolvedAt?: string
}

export type ContentDedupStats = {
  recordCount: number
  recordsWithEmbedding: number
  pendingDecisionCount: number
  resolvedDecisionCount: number
  logCount: number
  logsByAction: Record<string, number>
  logsByReason: Record<string, number>
}

export type ContentDedupScanCandidate = {
  left: ContentDedupRecord
  right: ContentDedupRecord
  reason: 'semantic_match' | 'url_match' | 'title_match'
  similarity: number | null
}

export type ContentDedupMergeResult = {
  source: ContentDedupRecord
  target: ContentDedupRecord
  mergedPageId: string
  updatedRecordCount: number
}

export type ContentDedupState = {
  version: 1
  schema: 'llm-wiki.content-dedup.v1'
  records: ContentDedupRecord[]
  logs: ContentDedupLogEntry[]
  pendingDecisions: ContentDedupPendingDecision[]
}
