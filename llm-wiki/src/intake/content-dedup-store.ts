import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { SourceKind } from '../types.js'
import { readSqliteState, writeSqliteState } from './content-dedup-sqlite.js'
import type {
  ContentDedupCandidate,
  ContentDedupCheck,
  ContentDedupLogEntry,
  ContentDedupMergeResult,
  ContentDedupPendingDecision,
  ContentDedupRecord,
  ContentDedupScanCandidate,
  ContentDedupState,
  ContentDedupStats,
  ContentDedupUserDecision,
} from './content-dedup-types.js'
export type {
  ContentDedupCandidate,
  ContentDedupCheck,
  ContentDedupLogEntry,
  ContentDedupMergeResult,
  ContentDedupPendingDecision,
  ContentDedupRecord,
  ContentDedupScanCandidate,
  ContentDedupStats,
  ContentDedupUserDecision,
} from './content-dedup-types.js'

const stateWriteQueues = new Map<string, Promise<void>>()

export function contentDedupIndexPath(knowledgeRoot: string): string {
  return contentDedupDatabasePath(knowledgeRoot)
}

export function contentDedupDatabasePath(knowledgeRoot: string): string {
  return path.join(path.resolve(knowledgeRoot), 'system', 'dedup', 'content-index.db')
}

export function normalizeContentForDedup(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function contentHashForDedup(content: string): string {
  return createHash('sha256').update(normalizeContentForDedup(content)).digest('hex')
}

export function createContentDedupStore(statePath: string) {
  const stateKey = path.resolve(statePath)
  const dbPath = contentDedupDbPathForStatePath(statePath)

  const withWriteLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previousTail = stateWriteQueues.get(stateKey) ?? Promise.resolve()
    const result = previousTail.catch(() => undefined).then(operation)
    const nextTail = result.then(() => undefined, () => undefined)
    stateWriteQueues.set(stateKey, nextTail)
    try {
      return await result
    } finally {
      if (stateWriteQueues.get(stateKey) === nextTail) {
        stateWriteQueues.delete(stateKey)
      }
    }
  }

  const awaitPendingWrites = async () => {
    await (stateWriteQueues.get(stateKey) ?? Promise.resolve())
  }

  return {
    async check(input: {
      sourceIdentity: string
      sourceKind: SourceKind
      sourceUrl?: string | null
      title: string
      content: string
      embeddingVector?: number[] | null
      embeddingProvider?: string | null
      embeddingModel?: string | null
    }): Promise<ContentDedupCheck> {
      await awaitPendingWrites()
      const state = await readState(statePath, dbPath)
      const docHash = contentHashForDedup(input.content)
      const exactMatch = state.records.find((record) => record.docHash === docHash && record.sourceIdentity !== input.sourceIdentity) ?? null
      const sourceUrl = normalizeSourceUrl(input.sourceUrl)
      const normalizedTitle = normalizeTitle(input.title)
      const semanticCandidates = semanticCandidatesFor({
        records: state.records,
        sourceIdentity: input.sourceIdentity,
        embeddingVector: input.embeddingVector ?? null,
        embeddingProvider: input.embeddingProvider ?? null,
        embeddingModel: input.embeddingModel ?? null,
      })
      const semanticMatch = semanticCandidates.find((candidate) => (candidate.similarity ?? 0) >= 0.98) ?? null
      const candidates = state.records.flatMap((record): ContentDedupCandidate[] => {
        if (record.docHash === docHash || record.sourceIdentity === input.sourceIdentity) {
          return []
        }
        const semanticCandidate = semanticCandidates.find((candidate) => candidate.record.docHash === record.docHash)
        if (semanticCandidate && (semanticCandidate.similarity ?? 0) >= 0.88) {
          return [semanticCandidate]
        }
        if (sourceUrl && record.sourceUrl === sourceUrl) {
          return [{ record, reason: 'url_match', similarity: semanticCandidate?.similarity ?? null }]
        }
        const titleSimilarity = titleTokenSimilarity(normalizedTitle, record.normalizedTitle)
        return titleSimilarity >= 0.85 ? [{ record, reason: 'title_match', similarity: titleSimilarity }] : []
      })
      return { docHash, exactMatch, semanticMatch, candidates }
    },

    async getResolvedDecision(input: {
      docHash: string
      sourceIdentity: string
    }): Promise<ContentDedupPendingDecision | null> {
      await awaitPendingWrites()
      const state = await readState(statePath, dbPath)
      return state.pendingDecisions
        .filter((decision) =>
          decision.status === 'resolved'
          && decision.newDocHash === input.docHash
          && decision.sourceIdentity === input.sourceIdentity,
        )
        .sort((left, right) => (right.resolvedAt ?? right.createdAt).localeCompare(left.resolvedAt ?? left.createdAt))[0] ?? null
    },

    async createPendingDecision(input: {
      docHash: string
      sourceIdentity: string
      sourceKind: SourceKind
      sourceUrl?: string | null
      title: string
      candidate: ContentDedupCandidate
      now?: string
    }): Promise<ContentDedupPendingDecision> {
      return withWriteLock(async () => {
        const state = await readState(statePath, dbPath)
        const existing = state.pendingDecisions.find((decision) =>
          decision.status === 'pending'
          && decision.newDocHash === input.docHash
          && decision.sourceIdentity === input.sourceIdentity
          && decision.matchedDocHash === input.candidate.record.docHash,
        )
        if (existing) {
          return existing
        }

        const now = input.now ?? new Date().toISOString()
        const pending: ContentDedupPendingDecision = {
          id: randomUUID(),
          status: 'pending',
          newDocHash: input.docHash,
          sourceIdentity: input.sourceIdentity,
          sourceKind: input.sourceKind,
          sourceUrl: normalizeSourceUrl(input.sourceUrl),
          title: input.title,
          matchedDocHash: input.candidate.record.docHash,
          matchedSourceIdentity: input.candidate.record.sourceIdentity,
          matchedPageId: input.candidate.record.pageId,
          reason: pendingReasonForCandidate(input.candidate),
          similarity: input.candidate.similarity,
          createdAt: now,
        }
        state.pendingDecisions.push(pending)
        state.logs.push(buildLogEntry({
          newDocHash: input.docHash,
          matchedDocHash: input.candidate.record.docHash,
          action: 'pending',
          reason: pending.reason,
          similarity: input.candidate.similarity,
          sourceIdentity: input.sourceIdentity,
          matchedSourceIdentity: input.candidate.record.sourceIdentity,
          now,
        }))
        await writeState(dbPath, sortState(state))
        return pending
      })
    },

    async listPendingDecisions(): Promise<ContentDedupPendingDecision[]> {
      await awaitPendingWrites()
      const state = await readState(statePath, dbPath)
      return state.pendingDecisions.filter((decision) => decision.status === 'pending')
    },

    async listRecords(): Promise<ContentDedupRecord[]> {
      await awaitPendingWrites()
      const state = await readState(statePath, dbPath)
      return state.records
    },

    async stats(): Promise<ContentDedupStats> {
      await awaitPendingWrites()
      const state = await readState(statePath, dbPath)
      return {
        recordCount: state.records.length,
        recordsWithEmbedding: state.records.filter((record) => record.embeddingVector && record.embeddingVector.length > 0).length,
        pendingDecisionCount: state.pendingDecisions.filter((decision) => decision.status === 'pending').length,
        resolvedDecisionCount: state.pendingDecisions.filter((decision) => decision.status === 'resolved').length,
        logCount: state.logs.length,
        logsByAction: countBy(state.logs, (log) => log.action),
        logsByReason: countBy(state.logs, (log) => log.reason),
      }
    },

    async scanCandidates(): Promise<ContentDedupScanCandidate[]> {
      await awaitPendingWrites()
      const state = await readState(statePath, dbPath)
      return scanContentDedupCandidates(state.records)
    },

    async mergeRecords(input: {
      source: string
      target: string
      reviewer: string
      note?: string
      now?: string
    }): Promise<ContentDedupMergeResult> {
      return withWriteLock(async () => {
        const state = await readState(statePath, dbPath)
        const source = resolveSingleRecordReference(state.records, input.source, 'source')
        const target = resolveSingleRecordReference(state.records, input.target, 'target')

        if (source.pageId === target.pageId) {
          throw new Error(`Content dedup source and target already point to the same page: ${source.pageId}`)
        }

        const now = input.now ?? new Date().toISOString()
        const sourcePageId = source.pageId
        const targetPageId = target.pageId
        let updatedRecordCount = 0

        state.records = state.records.map((record) => {
          if (record.pageId !== sourcePageId) {
            return record
          }
          updatedRecordCount += 1
          return {
            ...record,
            pageId: targetPageId,
            updatedAt: now,
          }
        })

        state.pendingDecisions = state.pendingDecisions.map((decision) => (
          decision.matchedPageId === sourcePageId
            ? { ...decision, matchedPageId: targetPageId }
            : decision
        ))

        state.logs.push(buildLogEntry({
          newDocHash: source.docHash,
          matchedDocHash: target.docHash,
          action: 'merge',
          reason: 'user_override',
          similarity: null,
          sourceIdentity: source.sourceIdentity,
          matchedSourceIdentity: target.sourceIdentity,
          now,
        }))

        await writeState(dbPath, sortState(state))

        return {
          source,
          target,
          mergedPageId: targetPageId,
          updatedRecordCount,
        }
      })
    },

    async resolvePendingDecision(input: {
      id: string
      decision: ContentDedupUserDecision
      reviewer: string
      note?: string
      now?: string
    }): Promise<ContentDedupPendingDecision> {
      return withWriteLock(async () => {
        const state = await readState(statePath, dbPath)
        const index = state.pendingDecisions.findIndex((decision) => decision.id === input.id)
        if (index < 0) {
          throw new Error(`Unknown content dedup decision: ${input.id}`)
        }

        const current = state.pendingDecisions[index]!
        if (current.status !== 'pending') {
          throw new Error(`Content dedup decision is already resolved: ${input.id}`)
        }

        const now = input.now ?? new Date().toISOString()
        const resolved: ContentDedupPendingDecision = {
          ...current,
          status: 'resolved',
          userDecision: input.decision,
          reviewer: input.reviewer,
          ...(input.note ? { note: input.note } : {}),
          resolvedAt: now,
        }
        state.pendingDecisions[index] = resolved
        state.logs.push(buildLogEntry({
          newDocHash: resolved.newDocHash,
          matchedDocHash: resolved.matchedDocHash,
          action: 'decision',
          reason: 'user_override',
          similarity: resolved.similarity,
          sourceIdentity: resolved.sourceIdentity,
          matchedSourceIdentity: resolved.matchedSourceIdentity,
          userDecision: input.decision,
          now,
        }))
        await writeState(dbPath, sortState(state))
        return resolved
      })
    },

    async recordDocument(input: {
      docHash: string
      sourceIdentity: string
      sourceKind: SourceKind
      sourceUrl?: string | null
      title: string
      pageId: string
      chunkCount: number
      embeddingProvider?: string | null
      embeddingModel?: string | null
      embeddingVector?: number[] | null
      now?: string
    }): Promise<ContentDedupRecord> {
      return withWriteLock(async () => {
        const state = await readState(statePath, dbPath)
        const now = input.now ?? new Date().toISOString()
        const existingIndex = state.records.findIndex((record) => record.docHash === input.docHash)
        const existing = existingIndex >= 0 ? state.records[existingIndex] : null
        const record: ContentDedupRecord = {
          docHash: input.docHash,
          sourceIdentity: input.sourceIdentity,
          sourceKind: input.sourceKind,
          sourceUrl: normalizeSourceUrl(input.sourceUrl),
          title: input.title,
          normalizedTitle: normalizeTitle(input.title),
          pageId: input.pageId,
          chunkCount: input.chunkCount,
          ...(input.embeddingProvider ? { embeddingProvider: input.embeddingProvider } : {}),
          ...(input.embeddingModel ? { embeddingModel: input.embeddingModel } : {}),
          ...(input.embeddingVector && input.embeddingVector.length > 0
            ? {
                embeddingDims: input.embeddingVector.length,
                embeddingVector: input.embeddingVector,
              }
            : {}),
          ingestedAt: existing?.ingestedAt ?? now,
          updatedAt: now,
        }
        if (existingIndex >= 0) {
          state.records[existingIndex] = record
        } else {
          state.records.push(record)
        }
        state.logs.push(buildLogEntry({
          newDocHash: input.docHash,
          matchedDocHash: existing?.docHash ?? null,
          action: 'record',
          reason: 'record_success',
          similarity: null,
          sourceIdentity: input.sourceIdentity,
          matchedSourceIdentity: existing?.sourceIdentity ?? null,
          now,
        }))
        await writeState(dbPath, sortState(state))
        return record
      })
    },

    async recordSkip(input: {
      docHash: string
      sourceIdentity: string
      match: ContentDedupRecord
      reason?: 'exact_hash' | 'semantic_0.98'
      similarity?: number | null
      now?: string
    }): Promise<void> {
      await appendLog(statePath, {
        newDocHash: input.docHash,
        matchedDocHash: input.match.docHash,
        action: 'skip',
        reason: input.reason ?? 'exact_hash',
        similarity: input.similarity ?? 1,
        sourceIdentity: input.sourceIdentity,
        matchedSourceIdentity: input.match.sourceIdentity,
        now: input.now,
      }, withWriteLock, dbPath)
    },

    async recordCandidates(input: {
      docHash: string
      sourceIdentity: string
      candidates: ContentDedupCandidate[]
      now?: string
    }): Promise<void> {
      for (const candidate of input.candidates) {
        await appendLog(statePath, {
          newDocHash: input.docHash,
          matchedDocHash: candidate.record.docHash,
          action: 'candidate',
          reason: candidate.reason === 'semantic_match' ? 'semantic_0.88' : candidate.reason,
          similarity: candidate.similarity,
          sourceIdentity: input.sourceIdentity,
          matchedSourceIdentity: candidate.record.sourceIdentity,
          now: input.now,
        }, withWriteLock, dbPath)
      }
    },
  }
}

async function appendLog(
  statePath: string,
  input: Omit<Parameters<typeof buildLogEntry>[0], 'now'> & { now?: string },
  withWriteLock: <T>(operation: () => Promise<T>) => Promise<T>,
  dbPath: string,
): Promise<void> {
  await withWriteLock(async () => {
    const state = await readState(statePath, dbPath)
    state.logs.push(buildLogEntry(input))
    await writeState(dbPath, sortState(state))
  })
}

async function readState(statePath: string, dbPath: string): Promise<ContentDedupState> {
  const sqliteState = readSqliteState(dbPath)
  return sqliteState ?? emptyState()
}

async function writeState(dbPath: string, state: ContentDedupState): Promise<void> {
  writeSqliteState(dbPath, state)
}

function contentDedupDbPathForStatePath(statePath: string): string {
  return statePath
}

function emptyState(): ContentDedupState {
  return { version: 1, schema: 'llm-wiki.content-dedup.v1', records: [], logs: [], pendingDecisions: [] }
}

function sortState(state: ContentDedupState): ContentDedupState {
  return {
    ...state,
    records: [...state.records].sort((left, right) => left.docHash.localeCompare(right.docHash)),
    logs: [...state.logs].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
    pendingDecisions: [...state.pendingDecisions].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)),
  }
}

function buildLogEntry(input: {
  newDocHash: string
  matchedDocHash: string | null
  action: ContentDedupLogEntry['action']
  reason: ContentDedupLogEntry['reason']
  similarity: number | null
  sourceIdentity: string
  matchedSourceIdentity: string | null
  userDecision?: ContentDedupUserDecision
  now?: string
}): ContentDedupLogEntry {
  return {
    id: randomUUID(),
    newDocHash: input.newDocHash,
    matchedDocHash: input.matchedDocHash,
    action: input.action,
    reason: input.reason,
    similarity: input.similarity,
    sourceIdentity: input.sourceIdentity,
    matchedSourceIdentity: input.matchedSourceIdentity,
    ...(input.userDecision ? { userDecision: input.userDecision } : {}),
    createdAt: input.now ?? new Date().toISOString(),
  }
}

function pendingReasonForCandidate(candidate: ContentDedupCandidate): ContentDedupPendingDecision['reason'] {
  return candidate.reason === 'semantic_match' ? 'semantic_0.88' : candidate.reason
}

function countBy<T>(values: T[], getKey: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    const key = getKey(value)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function normalizeSourceUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim() : null
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function titleTokenSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  const union = new Set([...leftTokens, ...rightTokens])
  if (union.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1
  }
  return intersection / union.size
}

function semanticCandidatesFor(input: {
  records: ContentDedupRecord[]
  sourceIdentity: string
  embeddingVector: number[] | null
  embeddingProvider: string | null
  embeddingModel: string | null
}): ContentDedupCandidate[] {
  if (!input.embeddingVector || input.embeddingVector.length === 0 || !input.embeddingProvider || !input.embeddingModel) {
    return []
  }

  return input.records
    .flatMap((record): ContentDedupCandidate[] => {
      if (record.sourceIdentity === input.sourceIdentity || record.embeddingProvider !== input.embeddingProvider || record.embeddingModel !== input.embeddingModel || !record.embeddingVector) {
        return []
      }
      const similarity = cosineSimilarity(input.embeddingVector!, record.embeddingVector)
      return similarity === null ? [] : [{ record, reason: 'semantic_match', similarity }]
    })
    .sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))
    .slice(0, 5)
}

function scanContentDedupCandidates(records: ContentDedupRecord[]): ContentDedupScanCandidate[] {
  const candidates: ContentDedupScanCandidate[] = []

  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
      const left = records[leftIndex]!
      const right = records[rightIndex]!
      if (left.pageId === right.pageId) {
        continue
      }
      const semanticSimilarity = semanticSimilarityForRecords(left, right)
      if (semanticSimilarity !== null && semanticSimilarity >= 0.88) {
        candidates.push({ left, right, reason: 'semantic_match', similarity: semanticSimilarity })
        continue
      }
      if (left.sourceUrl && left.sourceUrl === right.sourceUrl) {
        candidates.push({ left, right, reason: 'url_match', similarity: semanticSimilarity })
        continue
      }
      const titleSimilarity = titleTokenSimilarity(left.normalizedTitle, right.normalizedTitle)
      if (titleSimilarity >= 0.85) {
        candidates.push({ left, right, reason: 'title_match', similarity: titleSimilarity })
      }
    }
  }

  return candidates.sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0))
}

function resolveSingleRecordReference(records: ContentDedupRecord[], reference: string, role: 'source' | 'target'): ContentDedupRecord {
  const normalizedReference = normalizeRecordReference(reference)
  const matches = records.filter((record) =>
    record.docHash === reference
    || record.sourceIdentity === reference
    || record.sourceIdentity === path.resolve(reference)
    || record.pageId === normalizedReference,
  )

  if (matches.length === 0) {
    throw new Error(`Unknown content dedup ${role} reference: ${reference}`)
  }

  const uniqueByDocHash = new Map(matches.map((record) => [record.docHash, record]))
  if (uniqueByDocHash.size > 1) {
    throw new Error(`Ambiguous content dedup ${role} reference: ${reference}. Use a document hash or source identity.`)
  }

  return matches[0]!
}

function normalizeRecordReference(reference: string): string {
  const normalized = reference.replace(/\\/g, '/').replace(/^\.\//, '')
  const withoutWikiPrefix = normalized.startsWith('wiki/') ? normalized.slice('wiki/'.length) : normalized
  return withoutWikiPrefix.endsWith('.md') ? withoutWikiPrefix.slice(0, -'.md'.length) : withoutWikiPrefix
}

function semanticSimilarityForRecords(left: ContentDedupRecord, right: ContentDedupRecord): number | null {
  if (
    !left.embeddingVector
    || !right.embeddingVector
    || left.embeddingProvider !== right.embeddingProvider
    || left.embeddingModel !== right.embeddingModel
  ) {
    return null
  }
  return cosineSimilarity(left.embeddingVector, right.embeddingVector)
}

function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length === 0) {
    return null
  }
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
    leftNorm += left[index]! ** 2
    rightNorm += right[index]! ** 2
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return null
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}
