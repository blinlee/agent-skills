import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { analyzeArtifact } from '../compile/analysis.js'
import { generateKnowledgeChanges } from '../compile/generation.js'
import { loadConfig } from '../config.js'
import { persistReviewItems, removeStaleReviewFiles } from '../governance/review.js'
import { applyTaxonomyEffects } from '../governance/taxonomy.js'
import {
  createEmptyLifecycleState,
  retainReviewableIntake,
  stageIntakeFile,
  stageNormalizedArtifact,
  archiveStagedFile,
  rejectIntakeFile,
  type IntakeLifecycleState,
} from '../intake/lifecycle.js'
import { contentDedupIndexPath, createContentDedupStore, type ContentDedupCandidate } from '../intake/content-dedup-store.js'
import { createDedupStore, type DedupDecision, type DedupEntry, type OutputPageSnapshot } from '../intake/dedup-store.js'
import { hashFileLike, hashParsedArtifactForDedup, hashSourceMetadata } from '../intake/fingerprint.js'
import { detectSourceMetadataMismatch } from '../intake/mismatch-gate.js'
import { classifySource, isSupportedSourceKind, type DiscoveredSourceKind } from '../intake/source-discovery.js'
import { createJobStore } from './job-store.js'
import { parseMarkdownSource } from '../parsers/markdown.js'
import { parseRepoSource } from '../parsers/repo.js'
import { parseTextSource } from '../parsers/text.js'
import { parseUrlSource } from '../parsers/url.js'
import type { ParsedArtifact } from '../parsers/base.js'
import { ensureKnowledgeRootLayout } from '../paths.js'
import type { JobStatus, SourceKind } from '../types.js'
import { stripManagedRawFrontmatter } from '../intake/raw-store.js'
import { updateWikiIndex } from '../wiki/index-log.js'
import { removeWikiPageFile, restoreWikiPageSnapshot, writeKnowledgeChanges } from '../wiki/page-writer.js'
import { applySourceSemanticLinks, pruneMissingSourceSemanticLinks } from '../wiki/semantic-links.js'
import { runBuildIndex } from '../index/wiki-index.js'
import type { EmbedIndexResult } from '../retrieval/embed-index.js'
import { loadContentDedupEmbedding } from '../intake/content-dedup-embedding.js'
import { runEntityExtraction, type RunEntityExtractionResult } from '../retrieval/entity-extract.js'
import { keyInfoIndexPath, runKeyInfoExtraction, type RunKeyInfoExtractionResult } from '../retrieval/key-info.js'
import { runIngestEmbedIndex, summarizeEmbeddingResult, summarizeIndexResult } from './ingest-indexing.js'
import { classifyUrlFailure, fetchCleanedUrlContent } from './url-source.js'

export type RunIngestJobInput = {
  knowledgeRoot: string
  input: string
  extractEntities?: boolean
  extractKeyInfo?: boolean
}

export type IngestJobResult = {
  jobId: string
  status: JobStatus
  sourceKind: DiscoveredSourceKind
  dedupDecision: DedupDecision | null
  writtenFiles: string[]
  reviewFiles: string[]
  taxonomyFiles: string[]
  stagedPath: string | null
  archivePath: string | null
  rejectedPath: string | null
  retainedPath: string | null
  index?: IngestIndexSummary
  embedding?: IngestEmbeddingSummary
}

type JobDetails = Record<string, unknown>

export type IngestIndexSummary =
  | {
    status: 'rebuilt'
    chunkCount: number
    pageCount: number
  }
  | {
    status: 'failed'
    error: string
  }

export type IngestEmbeddingSummary =
  | ({
    status: 'rebuilt'
  } & Pick<
    EmbedIndexResult,
    | 'provider'
    | 'model'
    | 'reusedCount'
    | 'missingCount'
    | 'embeddedCount'
    | 'staleRemovedCount'
    | 'batchSize'
    | 'concurrency'
    | 'batchCount'
    | 'providerRequestCount'
    | 'coverage'
  >)
  | {
    status: 'skipped'
    reason: string
  }
  | {
    status: 'failed'
    error: string
  }

export async function runIngestJob(input: RunIngestJobInput): Promise<IngestJobResult> {
  const config = loadConfig({
    knowledgeRoot: input.knowledgeRoot,
    jobStorePath: path.join(path.resolve(input.knowledgeRoot), 'system', 'jobs', 'jobs.json'),
  })

  await ensureKnowledgeRootLayout(config.knowledgeRoot)

  const jobStore = createJobStore(config.jobStorePath)
  const dedupStore = createDedupStore(path.join(config.knowledgeRoot, 'system', 'dedup', 'manifest.json'))
  const contentDedupStore = createContentDedupStore(contentDedupIndexPath(config.knowledgeRoot))
  const sourceKind = classifySource(input.input)
  const lifecycle = createEmptyLifecycleState()
  const writtenFiles: string[] = []
  const reviewFiles: string[] = []
  const taxonomyFiles: string[] = []
  const jobId = randomUUID()

  await jobStore.save({
    id: jobId,
    status: 'queued',
    sourceKind,
    sourceRef: input.input,
    details: {
      step: 'queued',
    },
  })

  const persistResult = async (status: JobStatus, dedupDecision: DedupDecision | null, details: JobDetails = {}) => {
    const index = details.index as IngestIndexSummary | undefined
    const embedding = details.embedding as IngestEmbeddingSummary | undefined
    await jobStore.updateStatus(jobId, status, {
      input: input.input,
      sourceKind,
      writtenFiles,
      reviewFiles,
      taxonomyFiles,
      stagedPath: lifecycle.stagedPath,
      archivePath: lifecycle.archivePath,
      rejectedPath: lifecycle.rejectedPath,
      retainedPath: lifecycle.retainedPath,
      dedupDecision,
      ...details,
    })

    return {
      jobId,
      status,
      sourceKind,
      dedupDecision,
      writtenFiles: [...writtenFiles],
      reviewFiles: [...reviewFiles],
      taxonomyFiles: [...taxonomyFiles],
      stagedPath: lifecycle.stagedPath,
      archivePath: lifecycle.archivePath,
      rejectedPath: lifecycle.rejectedPath,
      retainedPath: lifecycle.retainedPath,
      ...(index ? { index } : {}),
      ...(embedding ? { embedding } : {}),
    } satisfies IngestJobResult
  }

  try {
    await jobStore.updateStatus(jobId, 'running', { step: 'discover-source', input: input.input, sourceKind })

    if (!isSupportedSourceKind(sourceKind)) {
      lifecycle.rejectedPath = await rejectIntakeFile({
        knowledgeRoot: config.knowledgeRoot,
        inputPath: input.input,
        jobId,
        sourceKind: 'unknown',
      })

      return persistResult('rejected', null, {
        step: 'rejected',
        reason: 'unsupported-source-kind',
      })
    }

    const sourceIdentity = normalizeSourceIdentity(sourceKind, input.input)
    const preparedSource = await prepareSourceForDedup({
      sourceKind,
      input: input.input,
      sourceId: buildStableSourceId(sourceKind, sourceIdentity),
      stagedPath: lifecycle.stagedPath,
      urlFetchTimeoutMs: config.urlFetchTimeoutMs,
      repoSampleLimit: config.repoSamplingLimits.maxFiles,
    })
    const { fingerprint } = preparedSource
    const parsedArtifactForDedup = preparedSource.parsedArtifact ?? await parseSource({
      sourceKind,
      input: input.input,
      sourceId: buildStableSourceId(sourceKind, sourceIdentity),
      stagedPath: null,
      urlFetchTimeoutMs: config.urlFetchTimeoutMs,
      repoSampleLimit: config.repoSamplingLimits.maxFiles,
    })
    let contentDedupCheck = await contentDedupStore.check({
      sourceIdentity,
      sourceKind,
      sourceUrl: sourceKind === 'url' ? sourceIdentity : null,
      title: parsedArtifactForDedup.title,
      content: parsedArtifactForDedup.content,
    })
    const resolvedContentDedupDecision = await contentDedupStore.getResolvedDecision({
      docHash: contentDedupCheck.docHash,
      sourceIdentity,
    })
    const bypassContentDedupConfirmation = resolvedContentDedupDecision?.userDecision === 'ingest'
      || resolvedContentDedupDecision?.userDecision === 'keep_both'
      || resolvedContentDedupDecision?.userDecision === 'update'

    if (resolvedContentDedupDecision?.userDecision === 'skip') {
      return persistResult('completed', { action: 'skip', reason: 'content-dedup-user-skip' }, {
        step: 'content-dedup-user-skip',
        sourceIdentity,
        fingerprint,
        skipped: true,
        contentDedup: {
          docHash: contentDedupCheck.docHash,
          pendingDecisionId: resolvedContentDedupDecision.id,
          matchedPageId: resolvedContentDedupDecision.matchedPageId,
          matchedSourceIdentity: resolvedContentDedupDecision.matchedSourceIdentity,
          userDecision: resolvedContentDedupDecision.userDecision,
        },
      })
    }

    if (contentDedupCheck.exactMatch && !bypassContentDedupConfirmation) {
      await contentDedupStore.recordSkip({
        docHash: contentDedupCheck.docHash,
        sourceIdentity,
        match: contentDedupCheck.exactMatch,
      })
      return persistResult('completed', { action: 'skip', reason: 'content-exact-hash' }, {
        step: 'content-dedup-skip',
        sourceIdentity,
        fingerprint,
        skipped: true,
        contentDedup: {
          docHash: contentDedupCheck.docHash,
          matchedPageId: contentDedupCheck.exactMatch.pageId,
          matchedSourceIdentity: contentDedupCheck.exactMatch.sourceIdentity,
          reason: 'exact_hash',
        },
      })
    }
    const contentDedupEmbedding = await loadContentDedupEmbedding(parsedArtifactForDedup.content)
    if (contentDedupEmbedding.vector) {
      contentDedupCheck = await contentDedupStore.check({
        sourceIdentity,
        sourceKind,
        sourceUrl: sourceKind === 'url' ? sourceIdentity : null,
        title: parsedArtifactForDedup.title,
        content: parsedArtifactForDedup.content,
        embeddingVector: contentDedupEmbedding.vector,
        embeddingProvider: contentDedupEmbedding.provider,
        embeddingModel: contentDedupEmbedding.model,
      })
      if (contentDedupCheck.semanticMatch && !bypassContentDedupConfirmation) {
        await contentDedupStore.recordSkip({
          docHash: contentDedupCheck.docHash,
          sourceIdentity,
          match: contentDedupCheck.semanticMatch.record,
          reason: 'semantic_0.98',
          similarity: contentDedupCheck.semanticMatch.similarity,
        })
        return persistResult('completed', { action: 'skip', reason: 'content-semantic-high' }, {
          step: 'content-dedup-skip',
          sourceIdentity,
          fingerprint,
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
        })
      }
    }
    if (contentDedupCheck.candidates.length > 0) {
      await contentDedupStore.recordCandidates({
        docHash: contentDedupCheck.docHash,
        sourceIdentity,
        candidates: contentDedupCheck.candidates,
      })
    }
    const confirmationCandidate = bypassContentDedupConfirmation
      ? null
      : pickContentDedupConfirmationCandidate(contentDedupCheck.candidates)
    if (confirmationCandidate) {
      const pendingDecision = await contentDedupStore.createPendingDecision({
        docHash: contentDedupCheck.docHash,
        sourceIdentity,
        sourceKind,
        sourceUrl: sourceKind === 'url' ? sourceIdentity : null,
        title: parsedArtifactForDedup.title,
        candidate: confirmationCandidate,
      })
      return persistResult('needs_review', { action: 'pending', reason: 'content-dedup-confirmation' }, {
        step: 'content-dedup-confirmation',
        sourceIdentity,
        fingerprint,
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
      })
    }
    const previousDedupEntry = await dedupStore.get(sourceIdentity)
    const dedupDecision = await dedupStore.shouldCompile({
      identity: sourceIdentity,
      sourceKind,
      fingerprint,
    })

    await jobStore.updateStatus(jobId, 'running', {
      step: 'dedup-check',
      sourceIdentity,
      fingerprint,
      dedupDecision,
    })

    if (dedupDecision.action === 'skip') {
      return persistResult('completed', dedupDecision, {
        step: 'dedup-skip',
        sourceIdentity,
        fingerprint,
        skipped: true,
      })
    }

    if (sourceKind === 'md' || sourceKind === 'txt') {
      lifecycle.stagedPath = await stageIntakeFile({
        knowledgeRoot: config.knowledgeRoot,
        inputPath: input.input,
        jobId,
        sourceKind,
      })
    }

    await jobStore.updateStatus(jobId, 'running', {
      step: 'parse-source',
      sourceIdentity,
      fingerprint,
      dedupDecision,
      stagedPath: lifecycle.stagedPath,
    })

    const parsedArtifact = parsedArtifactForDedup

    if (!lifecycle.stagedPath && (sourceKind === 'url' || sourceKind === 'repo')) {
      lifecycle.stagedPath = await stageNormalizedArtifact({
        knowledgeRoot: config.knowledgeRoot,
        jobId,
        sourceKind,
        sourceRef: input.input,
        title: parsedArtifact.title,
        content: parsedArtifact.content,
      })
    }

    const metadataMismatch = detectSourceMetadataMismatch(parsedArtifact)
    const analysis = await analyzeArtifact(parsedArtifact)
    const otherDedupEntries = (await dedupStore.list()).filter((entry) => entry.identity !== sourceIdentity)
    let generation = await generateKnowledgeChanges(analysis)
    const collisionFreeSourceSlug = resolveCollisionFreeSourceSlug(
      generation.sourcePage.slug,
      parsedArtifact.id,
      otherDedupEntries,
    )

    if (collisionFreeSourceSlug !== generation.sourcePage.slug) {
      generation = await generateKnowledgeChanges(analysis, { sourceSlug: collisionFreeSourceSlug })
    }

    const writeResult = await writeKnowledgeChanges({
      knowledgeRoot: config.knowledgeRoot,
      sourcePage: generation.sourcePage,
      entityPages: generation.entityPages,
      conceptPages: generation.conceptPages,
      synthesisSuggestions: generation.synthesisSuggestions,
      logEntry: generation.logMutations.map((mutation) => mutation.value).join('\n'),
      indexEntries: generation.indexMutations.map((mutation) => mutation.value),
      previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
    })
    const semanticLinkResult = await applySourceSemanticLinks({
      knowledgeRoot: config.knowledgeRoot,
      source: {
        slug: generation.sourcePage.slug,
        title: generation.sourcePage.title,
      },
    })
    const staleDerivedReconciliation = await reconcileStaleDerivedOutputs({
      knowledgeRoot: config.knowledgeRoot,
      previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
      currentOutputManifest: writeResult.outputManifest,
      otherEntries: otherDedupEntries,
      urlFetchTimeoutMs: config.urlFetchTimeoutMs,
      repoSampleLimit: config.repoSamplingLimits.maxFiles,
    })
    const semanticPruneResult = await pruneMissingSourceSemanticLinks(config.knowledgeRoot)
    writtenFiles.push(
      ...writeResult.writtenFiles,
      ...semanticLinkResult.writtenFiles,
      ...staleDerivedReconciliation.writtenFiles,
      ...semanticPruneResult.writtenFiles,
    )

    const reviewArtifacts = [
      ...(metadataMismatch
        ? [{
            id: `${parsedArtifact.id}-metadata-mismatch`,
            artifactId: parsedArtifact.id,
            type: metadataMismatch.type,
            issueSummary: metadataMismatch.reason,
            severity: metadataMismatch.severity,
            reason: metadataMismatch.reason,
            status: 'open',
            relatedSources: [parsedArtifact.sourceRef],
            relatedPages: buildReviewRelatedPages(generation),
            evidence: metadataMismatch.evidence,
            confidence: 0.9,
            suggestedActions: [
              'Verify whether source filename/URL metadata belongs to this parsed content before promoting it into stable wiki pages.',
              'If mismatched, move the item out of source intake or correct the source metadata/title before re-ingesting.',
            ],
            mismatch: metadataMismatch,
          }]
        : []),
      ...generation.reviewEffects.map((effect, index) => ({
        id: `${parsedArtifact.id}-review-${index + 1}`,
        artifactId: parsedArtifact.id,
        type: effect.kind,
        issueSummary: effect.reason,
        severity: effect.severity,
        reason: effect.reason,
        status: 'open',
        relatedSources: [parsedArtifact.sourceRef],
        relatedPages: buildReviewRelatedPages(generation),
        evidence: effect.evidence ?? [effect.reason],
        confidence: effect.confidence,
        candidate: effect.candidate,
        suggestedActions: effect.suggestedActions ?? buildDefaultReviewSuggestedActions(effect.kind),
      })),
    ]

    if (reviewArtifacts.length > 0) {
      const reviewResult = await persistReviewItems(config.knowledgeRoot, reviewArtifacts)
      reviewFiles.push(...reviewResult.files)
    }

    const currentReviewManifest = reviewFiles.map((filePath) => path.relative(config.knowledgeRoot, filePath))
    await removeStaleReviewFiles(
      config.knowledgeRoot,
      previousDedupEntry?.lastOutputManifest?.reviewFiles ?? [],
      currentReviewManifest,
    )

    if (generation.taxonomyEffects.length > 0) {
      const taxonomyResult = await applyTaxonomyEffects(config.knowledgeRoot, {
        topicProposals: generation.taxonomyEffects.map((effect) => ({
          name: effect.title,
          confidence: effect.confidence,
          rationale: effect.rationale,
          sources: [effect.source],
        })),
      })
      taxonomyFiles.push(...taxonomyResult.files)
    }

    let entityExtractionResult: RunEntityExtractionResult | null = null
    if (input.extractEntities) {
      try {
        entityExtractionResult = await runEntityExtraction({
          knowledgeRoot: config.knowledgeRoot,
          artifact: parsedArtifact,
          pageTarget: `sources/${generation.sourcePage.slug}`,
          pageTitle: generation.sourcePage.title,
          sourceIdentity,
          sourceKind,
        })
        if (entityExtractionResult.status === 'extracted') {
          writtenFiles.push(entityExtractionResult.filePath)
        }
      } catch (error) {
        entityExtractionResult = {
          status: 'skipped',
          reason: `entity extraction failed: ${(error as Error).message}`,
          filePath: path.join(config.knowledgeRoot, 'system', 'index', 'entity-extractions.json'),
        }
      }
    }

    let keyInfoExtractionResult: RunKeyInfoExtractionResult | null = null
    if (input.extractKeyInfo) {
      try {
        keyInfoExtractionResult = await runKeyInfoExtraction({
          knowledgeRoot: config.knowledgeRoot,
          artifact: parsedArtifact,
          pageTarget: `sources/${generation.sourcePage.slug}`,
          pageTitle: generation.sourcePage.title,
          sourceIdentity,
          sourceKind,
        })
        if (keyInfoExtractionResult.status === 'extracted') {
          writtenFiles.push(keyInfoExtractionResult.filePath)
        }
      } catch (error) {
        keyInfoExtractionResult = {
          status: 'skipped',
          reason: `key_info extraction failed: ${(error as Error).message}`,
          filePath: keyInfoIndexPath(config.knowledgeRoot),
        }
      }
    }

    let indexResult: Awaited<ReturnType<typeof runBuildIndex>> | null = null
    let embedResult: EmbedIndexResult | null = null
    let indexFailure: string | null = null
    let embeddingFailure: string | null = null
    let embeddingSkippedReason: string | null = null

    const finalStatus = resolveFinalStatus(Boolean(metadataMismatch) || generation.reviewEffects.length > 0 || generation.taxonomyEffects.length > 0)
    let resultStatus = finalStatus
    const outputManifest = {
      ...writeResult.outputManifest,
      reviewFiles: currentReviewManifest,
    }

    if (finalStatus === 'completed') {
      if (lifecycle.stagedPath) {
        lifecycle.archivePath = await archiveStagedFile(config.knowledgeRoot, lifecycle.stagedPath)
        lifecycle.stagedPath = null
      }
    } else if (lifecycle.stagedPath) {
      lifecycle.retainedPath = await retainReviewableIntake(lifecycle.stagedPath)
    }

    // Rebuild after raw lifecycle finalization so raw-backed citations do not
    // point at stale staged paths once a completed source moves to archive.
    try {
      indexResult = await runBuildIndex({ knowledgeRoot: config.knowledgeRoot })
      try {
        const optionalEmbedResult = await runIngestEmbedIndex(config.knowledgeRoot)
        embedResult = optionalEmbedResult.result
        embeddingSkippedReason = optionalEmbedResult.skippedReason
      } catch (error) {
        embeddingFailure = error instanceof Error ? error.message : String(error)
        // embedding is optional; do not fail the ingest
      }
    } catch (error) {
      indexFailure = error instanceof Error ? error.message : String(error)
      resultStatus = finalStatus === 'completed' ? 'partial' : finalStatus
    }

    if (shouldRecordSuccessfulManifest(resultStatus)) {
      await dedupStore.recordSuccess({
        identity: sourceIdentity,
        sourceKind,
        fingerprint,
        jobId,
        outputManifest,
      })
    }
    if (shouldRecordSuccessfulManifest(resultStatus) && indexResult) {
      await contentDedupStore.recordDocument({
        docHash: contentDedupCheck.docHash,
        sourceIdentity,
        sourceKind,
        sourceUrl: sourceKind === 'url' ? sourceIdentity : null,
        title: parsedArtifact.title,
        pageId: `sources/${generation.sourcePage.slug}`,
        chunkCount: indexResult?.chunkCount ?? 0,
        embeddingProvider: contentDedupEmbedding.provider,
        embeddingModel: contentDedupEmbedding.model,
        embeddingVector: contentDedupEmbedding.vector,
      })
    }

    return persistResult(resultStatus, dedupDecision, {
      step: 'completed',
      sourceIdentity,
      fingerprint,
      reviewTriggerCount: analysis.reviewTriggers.length,
      entityCount: analysis.candidateEntities.length,
      conceptCount: analysis.candidateConcepts.length,
      ...(entityExtractionResult ? {
        entityExtraction: {
          status: entityExtractionResult.status,
          reason: entityExtractionResult.reason,
          entityCount: entityExtractionResult.record?.entities.length ?? 0,
          relationshipCount: entityExtractionResult.record?.relationships.length ?? 0,
          keyValueCount: entityExtractionResult.record?.keyValues.length ?? 0,
          filePath: entityExtractionResult.filePath,
        },
      } : {}),
      ...(keyInfoExtractionResult ? {
        keyInfoExtraction: {
          status: keyInfoExtractionResult.status,
          reason: keyInfoExtractionResult.reason,
          keyClaimCount: keyInfoExtractionResult.record?.keyClaims.length ?? 0,
          evidenceCount: keyInfoExtractionResult.record?.evidence.length ?? 0,
          filePath: keyInfoExtractionResult.filePath,
        },
      } : {}),
      contentDedup: {
        docHash: contentDedupCheck.docHash,
        ...(resolvedContentDedupDecision ? {
          userDecision: resolvedContentDedupDecision.userDecision,
          pendingDecisionId: resolvedContentDedupDecision.id,
        } : {}),
        ...(contentDedupEmbedding.provider ? { embeddingProvider: contentDedupEmbedding.provider } : {}),
        ...(contentDedupEmbedding.model ? { embeddingModel: contentDedupEmbedding.model } : {}),
        ...(contentDedupEmbedding.diagnostic ? { embeddingDiagnostic: contentDedupEmbedding.diagnostic } : {}),
        candidateCount: contentDedupCheck.candidates.length,
        candidates: contentDedupCheck.candidates.map((candidate) => ({
          reason: candidate.reason,
          similarity: candidate.similarity,
          matchedPageId: candidate.record.pageId,
          matchedSourceIdentity: candidate.record.sourceIdentity,
        })),
      },
      ...(metadataMismatch ? { metadataMismatch } : {}),
      ...(indexResult ? {
        index: summarizeIndexResult(indexResult),
      } : indexFailure ? {
        index: {
          status: 'failed',
          error: indexFailure,
        } satisfies IngestIndexSummary,
      } : {}),
      ...(embedResult ? {
        embedding: summarizeEmbeddingResult(embedResult),
      } : embeddingSkippedReason ? {
        embedding: {
          status: 'skipped',
          reason: embeddingSkippedReason,
        } satisfies IngestEmbeddingSummary,
      } : embeddingFailure ? {
        embedding: {
          status: 'failed',
          error: embeddingFailure,
        } satisfies IngestEmbeddingSummary,
      } : {}),
    })
  } catch (error) {
    if (!lifecycle.rejectedPath && isLocalFileCandidate(sourceKind, input.input)) {
      lifecycle.rejectedPath = await rejectIntakeFile({
        knowledgeRoot: config.knowledgeRoot,
        inputPath: input.input,
        jobId,
        sourceKind: isSupportedSourceKind(sourceKind) ? sourceKind : 'unknown',
        stagedPath: lifecycle.stagedPath,
      })
      lifecycle.stagedPath = null
    }

    return persistResult(resolveFailureStatus(sourceKind, error), null, {
      step: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function buildReviewRelatedPages(generation: Awaited<ReturnType<typeof generateKnowledgeChanges>>): string[] {
  return [
    `sources/${generation.sourcePage.slug}`,
    ...generation.entityPages.map((page) => `entities/${page.slug}`),
    ...generation.conceptPages.map((page) => `concepts/${page.slug}`),
  ]
}

function buildDefaultReviewSuggestedActions(kind: string): string[] {
  if (kind === 'low-confidence') {
    return ['低置信候选仅作为治理信号处理；确认后再决定是否批准、合并、重命名或拒绝。']
  }

  if (kind === 'semantic-candidate') {
    return ['在创建稳定 wiki 语义前，先判断该候选是否应被批准、合并、重命名或拒绝。']
  }

  if (kind === 'ambiguous-classification') {
    return ['先解决分类歧义，再提升为稳定 taxonomy 或 wiki 结构。']
  }

  if (kind === 'source-metadata-mismatch') {
    return ['先核对文件名、URL、标题与正文是否属于同一来源；不一致时修正或隔离来源后再重新摄入。']
  }

  if (kind === 'sparse-artifact') {
    return ['补充来源证据，或明确标记该材料本来就是稀疏材料。']
  }

  return ['判断该事项是否应该改变稳定 wiki 或 taxonomy 状态。']
}

function shouldRecordSuccessfulManifest(status: JobStatus): boolean {
  return status === 'completed' || status === 'needs_review' || status === 'partial'
}

function pickContentDedupConfirmationCandidate(candidates: ContentDedupCandidate[]): ContentDedupCandidate | null {
  return candidates.find((candidate) =>
    candidate.reason === 'semantic_match'
    && (candidate.similarity ?? 0) >= 0.88
    && (candidate.similarity ?? 0) < 0.98,
  ) ?? candidates.find((candidate) => candidate.reason === 'url_match') ?? null
}

type DerivedPageOwner = {
  entry: DedupEntry
  snapshot: OutputPageSnapshot
}

async function reconcileStaleDerivedOutputs(input: {
  knowledgeRoot: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
  currentOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>
  otherEntries: DedupEntry[]
  urlFetchTimeoutMs: number
  repoSampleLimit: number
}): Promise<{ writtenFiles: string[] }> {
  const previousManifest = input.previousOutputManifest
  if (!previousManifest) {
    return { writtenFiles: [] }
  }

  const staleDerivedFiles = collectStaleDerivedFiles(previousManifest, input.currentOutputManifest)

  const retainedIndexEntries = new Set(
    input.otherEntries.flatMap((entry) => entry.lastOutputManifest?.indexEntries ?? []),
  )
  const indexEntriesToAdd = new Set<string>()
  const indexEntriesToRemove = new Set<string>()
  const writtenFiles: string[] = []
  for (const filePath of staleDerivedFiles) {
    const remainingOwners = await collectDerivedPageOwners({
      entries: input.otherEntries,
      filePath,
    })

    if (remainingOwners.length === 0) {
      await removeWikiPageFile(input.knowledgeRoot, filePath)
      writtenFiles.push(path.join(path.resolve(input.knowledgeRoot), filePath))
      continue
    }

    const survivor = pickMostRecentSnapshotOwner(remainingOwners)
    writtenFiles.push(await restoreWikiPageSnapshot(input.knowledgeRoot, survivor.snapshot))

    if (survivor.snapshot.indexEntry) {
      indexEntriesToAdd.add(survivor.snapshot.indexEntry)
    }
  }

  const staleIndexEntries = previousManifest.indexEntries.filter(
    (entry) => !input.currentOutputManifest.indexEntries.includes(entry) && !isSourceOwnedIndexEntry(entry),
  )

  for (const entry of staleIndexEntries) {
    if (!retainedIndexEntries.has(entry)) {
      indexEntriesToRemove.add(entry)
    }
  }

  if (indexEntriesToAdd.size > 0 || indexEntriesToRemove.size > 0) {
    writtenFiles.push(await updateWikiIndex(input.knowledgeRoot, {
      addEntries: [...indexEntriesToAdd],
      removeEntries: [...indexEntriesToRemove],
    }))
  }

  return {
    writtenFiles: [...new Set(writtenFiles)],
  }
}

function collectStaleDerivedFiles(
  previousOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>,
  currentOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>,
): string[] {
  const previousDerivedFiles = new Set<string>([
    ...previousOutputManifest.pageFiles.filter(isDerivedWikiPage),
    ...previousOutputManifest.pageSnapshots.map((snapshot) => snapshot.filePath).filter(isDerivedWikiPage),
  ])

  return [...previousDerivedFiles].filter((filePath) => !currentOutputManifest.pageFiles.includes(filePath))
}

async function collectDerivedPageOwners(input: {
  entries: DedupEntry[]
  filePath: string
}): Promise<DerivedPageOwner[]> {
  const owners = await Promise.all(input.entries.map(async (entry) => {
    const snapshots = entry.lastOutputManifest?.pageSnapshots ?? []

    return snapshots
      .filter((snapshot) => snapshot.filePath === input.filePath)
      .map((snapshot) => ({ entry, snapshot }))
  }))

  return owners.flat()
}

function pickMostRecentSnapshotOwner(
  owners: DerivedPageOwner[],
): DerivedPageOwner {
  return [...owners].sort((left, right) => compareCompiledAt(right.entry.lastCompiledAt, left.entry.lastCompiledAt))[0]
}

function compareCompiledAt(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY
  return leftTime - rightTime
}

function isDerivedWikiPage(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('wiki/entities/') || normalized.startsWith('wiki/concepts/')
}

function isSourceOwnedIndexEntry(entry: string): boolean {
  return /^[-*]\s+\[\[sources\/[^|\]]+\|[^\]]+\]\]$/.test(entry.trim())
}

async function parseSource(input: {
  sourceKind: SourceKind
  input: string
  sourceId: string
  stagedPath: string | null
  urlFetchTimeoutMs: number
  repoSampleLimit: number
}) {
  if (input.sourceKind === 'md' || input.sourceKind === 'txt') {
    const readPath = input.stagedPath ?? input.input
    const content = await readFile(readPath, 'utf8')
    const parserInput = {
      sourceId: input.sourceId,
      path: input.input,
      content: stripManagedRawFrontmatter(content),
    }

    return input.sourceKind === 'md'
      ? parseMarkdownSource(parserInput)
      : parseTextSource(parserInput)
  }

  if (input.sourceKind === 'repo') {
    return parseRepoSource({
      sourceId: input.sourceId,
      repoPath: input.input,
      maxSampleFiles: input.repoSampleLimit,
    })
  }

  return parseUrlSource(
    {
      sourceId: input.sourceId,
      url: input.input,
    },
    (url) => fetchCleanedUrlContent(url, input.urlFetchTimeoutMs),
  )
}

async function prepareSourceForDedup(input: {
  sourceKind: SourceKind
  input: string
  sourceId: string
  stagedPath: string | null
  urlFetchTimeoutMs: number
  repoSampleLimit: number
}): Promise<{ fingerprint: string; parsedArtifact: ParsedArtifact | null }> {
  if (input.sourceKind === 'md' || input.sourceKind === 'txt') {
    return {
      fingerprint: await fingerprintSource(input.sourceKind, input.input),
      parsedArtifact: null,
    }
  }

  const parsedArtifact = await parseSource({
    sourceKind: input.sourceKind,
    input: input.input,
    sourceId: input.sourceId,
    stagedPath: input.stagedPath,
    urlFetchTimeoutMs: input.urlFetchTimeoutMs,
    repoSampleLimit: input.repoSampleLimit,
  })

  return {
    fingerprint: hashParsedArtifactForDedup(parsedArtifact),
    parsedArtifact,
  }
}

async function fingerprintSource(sourceKind: SourceKind, source: string): Promise<string> {
  if (sourceKind === 'md' || sourceKind === 'txt') {
    return hashFileLike(await readFile(source))
  }

  if (sourceKind === 'repo') {
    const fileStat = await stat(source)
    return hashSourceMetadata({
      kind: sourceKind,
      identity: normalizeSourceIdentity(sourceKind, source),
      size: fileStat.size,
      modifiedAt: fileStat.mtimeMs,
    })
  }

  return hashSourceMetadata({
    kind: sourceKind,
    identity: normalizeSourceIdentity(sourceKind, source),
  })
}

function normalizeSourceIdentity(sourceKind: SourceKind, source: string): string {
  return sourceKind === 'url' ? source.trim() : path.resolve(source)
}

function buildStableSourceId(sourceKind: SourceKind, sourceIdentity: string): string {
  return hashSourceMetadata({ sourceKind, sourceIdentity }).slice(0, 16)
}

function resolveCollisionFreeSourceSlug(baseSlug: string, artifactId: string, otherEntries: DedupEntry[]): string {
  if (!isSourceSlugOwnedByOtherEntry(baseSlug, otherEntries)) {
    return baseSlug
  }

  const suffix = artifactId.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 8) || 'source'
  const suffixedSlug = `${baseSlug}-${suffix}`

  if (!isSourceSlugOwnedByOtherEntry(suffixedSlug, otherEntries)) {
    return suffixedSlug
  }

  let counter = 2
  while (isSourceSlugOwnedByOtherEntry(`${suffixedSlug}-${counter}`, otherEntries)) {
    counter += 1
  }

  return `${suffixedSlug}-${counter}`
}

function isSourceSlugOwnedByOtherEntry(slug: string, otherEntries: DedupEntry[]): boolean {
  const sourcePagePath = path.posix.join('wiki', 'sources', `${slug}.md`)
  return otherEntries.some((entry) => entry.lastOutputManifest?.pageFiles.includes(sourcePagePath))
}

function resolveFinalStatus(hasReviewTriggers: boolean): JobStatus {
  if (hasReviewTriggers) {
    return 'needs_review'
  }

  return 'completed'
}

function isLocalFileCandidate(sourceKind: DiscoveredSourceKind, source: string): boolean {
  return sourceKind === 'md' || sourceKind === 'txt' || sourceKind === 'unknown'
}

function resolveFailureStatus(sourceKind: DiscoveredSourceKind, error: unknown): JobStatus {
  if (sourceKind === 'url' && classifyUrlFailure(error).retryable) {
    return 'failed_retryable'
  }

  return 'failed_terminal'
}
