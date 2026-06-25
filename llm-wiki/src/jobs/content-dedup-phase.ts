import type { DedupDecision, DedupEntry, DedupStore } from '../intake/dedup-store.js'
import {
  createContentDedupStore,
  type ContentDedupCandidate,
  type ContentDedupCheck,
  type ContentDedupPendingDecision,
} from '../intake/content-dedup-store.js'
import { loadContentDedupEmbedding } from '../intake/content-dedup-embedding.js'
import type { SourceKind } from '../types.js'

export type ContentDedupStore = ReturnType<typeof createContentDedupStore>
export type ContentDedupEmbedding = Awaited<ReturnType<typeof loadContentDedupEmbedding>>

export type ContentDedupPhaseResult =
  | {
    status: 'ready'
    contentDedupCheck: ContentDedupCheck
    contentDedupEmbedding: ContentDedupEmbedding
    resolvedContentDedupDecision: ContentDedupPendingDecision | null
    effectiveDedupDecision: DedupDecision
  }
  | {
    status: 'completed' | 'needs_review'
    dedupDecision: DedupDecision
    details: Record<string, unknown>
  }

export async function runContentDedupPhase(input: {
  contentDedupStore: ContentDedupStore
  dedupStore: DedupStore
  sourceIdentity: string
  sourceKind: SourceKind
  title: string
  content: string
  fingerprint: string
  previousDedupEntry: DedupEntry | null
  forceRecompile?: boolean
  qualityPath?: string | null
  curationPath?: string | null
}): Promise<ContentDedupPhaseResult> {
  let contentDedupCheck = await input.contentDedupStore.check({
    sourceIdentity: input.sourceIdentity,
    sourceKind: input.sourceKind,
    sourceUrl: input.sourceKind === 'url' ? input.sourceIdentity : null,
    title: input.title,
    content: input.content,
  })
  const resolvedContentDedupDecision = await input.contentDedupStore.getResolvedDecision({
    docHash: contentDedupCheck.docHash,
    sourceIdentity: input.sourceIdentity,
  })
  const recompilingAcceptedSource = Boolean(input.forceRecompile && input.previousDedupEntry)
  const bypassContentDedupConfirmation = resolvedContentDedupDecision?.userDecision === 'ingest'
    || resolvedContentDedupDecision?.userDecision === 'keep_both'
    || resolvedContentDedupDecision?.userDecision === 'update'
    || recompilingAcceptedSource

  if (resolvedContentDedupDecision?.userDecision === 'skip') {
    return {
      status: 'completed',
      dedupDecision: { action: 'skip', reason: 'content-dedup-user-skip' },
      details: {
        step: 'content-dedup-user-skip',
        sourceIdentity: input.sourceIdentity,
        fingerprint: input.fingerprint,
        skipped: true,
        contentDedup: {
          docHash: contentDedupCheck.docHash,
          pendingDecisionId: resolvedContentDedupDecision.id,
          matchedPageId: resolvedContentDedupDecision.matchedPageId,
          matchedSourceIdentity: resolvedContentDedupDecision.matchedSourceIdentity,
          userDecision: resolvedContentDedupDecision.userDecision,
        },
      },
    }
  }

  if (contentDedupCheck.exactMatch && !bypassContentDedupConfirmation) {
    await input.contentDedupStore.recordSkip({
      docHash: contentDedupCheck.docHash,
      sourceIdentity: input.sourceIdentity,
      match: contentDedupCheck.exactMatch,
    })
    return {
      status: 'completed',
      dedupDecision: { action: 'skip', reason: 'content-exact-hash' },
      details: {
        step: 'content-dedup-skip',
        sourceIdentity: input.sourceIdentity,
        fingerprint: input.fingerprint,
        skipped: true,
        contentDedup: {
          docHash: contentDedupCheck.docHash,
          matchedPageId: contentDedupCheck.exactMatch.pageId,
          matchedSourceIdentity: contentDedupCheck.exactMatch.sourceIdentity,
          reason: 'exact_hash',
        },
      },
    }
  }

  const contentDedupEmbedding = await loadContentDedupEmbedding(input.content)
  if (contentDedupEmbedding.vector) {
    contentDedupCheck = await input.contentDedupStore.check({
      sourceIdentity: input.sourceIdentity,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceKind === 'url' ? input.sourceIdentity : null,
      title: input.title,
      content: input.content,
      embeddingVector: contentDedupEmbedding.vector,
      embeddingProvider: contentDedupEmbedding.provider,
      embeddingModel: contentDedupEmbedding.model,
    })
    if (contentDedupCheck.semanticMatch && !bypassContentDedupConfirmation) {
      await input.contentDedupStore.recordSkip({
        docHash: contentDedupCheck.docHash,
        sourceIdentity: input.sourceIdentity,
        match: contentDedupCheck.semanticMatch.record,
        reason: 'semantic_0.98',
        similarity: contentDedupCheck.semanticMatch.similarity,
      })
      return {
        status: 'completed',
        dedupDecision: { action: 'skip', reason: 'content-semantic-high' },
        details: {
          step: 'content-dedup-skip',
          sourceIdentity: input.sourceIdentity,
          fingerprint: input.fingerprint,
          skipped: true,
          contentDedup: {
            docHash: contentDedupCheck.docHash,
            matchedPageId: contentDedupCheck.semanticMatch.record.pageId,
            matchedSourceIdentity: contentDedupCheck.semanticMatch.record.sourceIdentity,
            reason: 'semantic_0.98',
            similarity: contentDedupCheck.semanticMatch.similarity,
            embeddingProvider: contentDedupEmbedding.provider,
            embeddingModel: contentDedupEmbedding.model,
          },
        },
      }
    }
  }

  if (contentDedupCheck.candidates.length > 0) {
    await input.contentDedupStore.recordCandidates({
      docHash: contentDedupCheck.docHash,
      sourceIdentity: input.sourceIdentity,
      candidates: contentDedupCheck.candidates,
    })
  }
  const confirmationCandidate = bypassContentDedupConfirmation
    ? null
    : pickContentDedupConfirmationCandidate(contentDedupCheck.candidates)
  if (confirmationCandidate) {
    const pendingDecision = await input.contentDedupStore.createPendingDecision({
      docHash: contentDedupCheck.docHash,
      sourceIdentity: input.sourceIdentity,
      sourceKind: input.sourceKind,
      sourceUrl: input.sourceKind === 'url' ? input.sourceIdentity : null,
      title: input.title,
      candidate: confirmationCandidate,
    })
    return {
      status: 'needs_review',
      dedupDecision: { action: 'pending', reason: 'content-dedup-confirmation' },
      details: {
        step: 'content-dedup-confirmation',
        sourceIdentity: input.sourceIdentity,
        fingerprint: input.fingerprint,
        contentDedup: {
          docHash: contentDedupCheck.docHash,
          pendingDecision,
          candidates: contentDedupCheck.candidates.map((candidate) => ({
            reason: candidate.reason,
            similarity: candidate.similarity,
            matchedPageId: candidate.record.pageId,
            matchedSourceIdentity: candidate.record.sourceIdentity,
          })),
        },
      },
    }
  }

  const dedupDecision = await input.dedupStore.shouldCompile({
    identity: input.sourceIdentity,
    sourceKind: input.sourceKind,
    fingerprint: input.fingerprint,
  })
  const retryingBlockedInboxGate = dedupDecision.action === 'skip'
    && input.previousDedupEntry?.lastStatus === 'needs_review'
    && Boolean(input.qualityPath || input.curationPath)
  const forcingRecompile = dedupDecision.action === 'skip' && Boolean(input.forceRecompile)
  const effectiveDedupDecision = forcingRecompile
    ? { action: 'recompile' as const, reason: 'forced-recompile' as const }
    : retryingBlockedInboxGate
    ? { action: 'recompile' as const, reason: 'inbox-gate-resolved' as const }
    : dedupDecision

  return {
    status: 'ready',
    contentDedupCheck,
    contentDedupEmbedding,
    resolvedContentDedupDecision,
    effectiveDedupDecision,
  }
}

function pickContentDedupConfirmationCandidate(candidates: ContentDedupCandidate[]): ContentDedupCandidate | null {
  return candidates.find((candidate) =>
    candidate.reason === 'semantic_match'
    && (candidate.similarity ?? 0) >= 0.88
    && (candidate.similarity ?? 0) < 0.98,
  ) ?? candidates.find((candidate) => candidate.reason === 'url_match') ?? null
}
