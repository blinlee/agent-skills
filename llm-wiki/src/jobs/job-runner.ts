import { randomUUID } from 'node:crypto'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { generateKnowledgeChanges } from '../compile/generation.js'
import {
  loadSemanticCurationPlan,
  semanticCurationNeedsReviewReasons,
  validateSemanticCurationPlan,
} from '../compile/semantic-curation.js'
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
import { backfillDedupManifestPageSnapshots } from '../intake/manifest-migration.js'
import { detectSourceMetadataMismatch } from '../intake/mismatch-gate.js'
import { classifySource, isSupportedSourceKind, type DiscoveredSourceKind } from '../intake/source-discovery.js'
import {
  inboxQualityNeedsReviewReasons,
  loadInboxQualityPlan,
  validateInboxQualityPlan,
} from '../intake/quality-gate.js'
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
import { refreshSemanticOverviews } from '../wiki/semantic-overviews.js'
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
  qualityPath?: string
  curationPath?: string
  extractEntities?: boolean
  extractKeyInfo?: boolean
  forceRecompile?: boolean
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

  const dedupManifestPath = path.join(config.knowledgeRoot, 'system', 'dedup', 'manifest.json')
  await backfillDedupManifestPageSnapshots({
    knowledgeRoot: config.knowledgeRoot,
    manifestPath: dedupManifestPath,
  })

  const jobStore = createJobStore(config.jobStorePath)
  const dedupStore = createDedupStore(dedupManifestPath)
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
    const previousDedupEntry = await dedupStore.get(sourceIdentity)
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
    const qualityPath = input.qualityPath ?? await findInboxQualitySidecar(input.input)
    const curationPath = input.curationPath ?? await findSemanticCurationSidecar(input.input)
    const recordQualityBlock = async () => {
      await dedupStore.recordSuccess({
        identity: sourceIdentity,
        sourceKind,
        fingerprint,
        jobId,
        status: 'needs_review',
        outputManifest: previousDedupEntry?.lastOutputManifest ?? null,
      })
    }
    if (!qualityPath) {
      const reviewResult = await persistReviewItems(config.knowledgeRoot, [{
        id: `${parsedArtifactForDedup.id}-inbox-quality-required`,
        artifactId: parsedArtifactForDedup.id,
        type: 'inbox-quality-required',
        issueSummary: '需要入库质量判断后才能完成入库。',
        severity: 'medium',
        reason: '缺少 llm-wiki.inbox-quality.v1 quality plan；inbox 必须先判断重复、可读性、垃圾/噪声、知识价值和建议动作。',
        status: 'open',
        relatedSources: [parsedArtifactForDedup.sourceRef],
        relatedPages: [],
        evidence: ['No --quality plan or sidecar quality plan was found.'],
        confidence: 1,
        suggestedActions: [
          '阅读规范化原文，按 llm-wiki.inbox-quality.v1 写出 quality JSON。',
          '如果材料应收入，decision=accept 后重新运行 ingest/route-accept 并传入 --quality <plan.json>。',
          '如果材料应拒收、暂存、转换或合并，先让用户批准对应动作。',
        ],
      }])
      reviewFiles.push(...reviewResult.files)
      await recordQualityBlock()
      return persistResult('needs_review', null, {
        step: 'inbox-quality-required',
        sourceIdentity,
        fingerprint,
        reviewTriggerCount: 1,
      })
    }

    let qualityPlan
    try {
      qualityPlan = validateInboxQualityPlan({
        artifact: parsedArtifactForDedup,
        plan: await loadInboxQualityPlan(qualityPath),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const reviewResult = await persistReviewItems(config.knowledgeRoot, [{
        id: `${parsedArtifactForDedup.id}-inbox-quality-invalid`,
        artifactId: parsedArtifactForDedup.id,
        type: 'inbox-quality-invalid',
        issueSummary: '入库质量判断无效，无法完成入库。',
        severity: 'high',
        reason,
        status: 'open',
        relatedSources: [parsedArtifactForDedup.sourceRef, qualityPath],
        relatedPages: [],
        evidence: [reason],
        confidence: 1,
        suggestedActions: [
          '修正 quality JSON 的 schema、字段、枚举或原文证据 quote。',
          '重新运行 ingest/route-accept --quality <plan.json>。',
        ],
      }])
      reviewFiles.push(...reviewResult.files)
      await recordQualityBlock()
      return persistResult('needs_review', null, {
        step: 'inbox-quality-invalid',
        sourceIdentity,
        fingerprint,
        qualityPath,
        reviewTriggerCount: 1,
      })
    }

    if (qualityPlan.status === 'needs_review' || qualityPlan.decision !== 'accept') {
      const reasons = inboxQualityNeedsReviewReasons(qualityPlan)
      const reviewResult = await persistReviewItems(config.knowledgeRoot, [{
        id: `${parsedArtifactForDedup.id}-inbox-quality-blocked`,
        artifactId: parsedArtifactForDedup.id,
        type: 'inbox-quality-blocked',
        issueSummary: '本材料未通过入库质量门槛。',
        severity: qualityPlan.decision === 'reject' ? 'high' : 'medium',
        reason: reasons.join('; ') || qualityPlan.reason,
        status: 'open',
        relatedSources: [parsedArtifactForDedup.sourceRef, qualityPath],
        relatedPages: [],
        evidence: qualityPlan.evidence.map((evidence) => evidence.quote),
        confidence: 1,
        suggestedActions: [
          `建议动作：${qualityPlan.decision}`,
          '向用户展示质量判断，等待批准 reject / park / convert / merge / accept 之一。',
          '只有改为 decision=accept 且语义整理也有效时，才继续普通入库。',
        ],
      }])
      reviewFiles.push(...reviewResult.files)
      await recordQualityBlock()
      return persistResult('needs_review', null, {
        step: 'inbox-quality-blocked',
        sourceIdentity,
        fingerprint,
        qualityPath,
        qualityDecision: qualityPlan.decision,
        knowledgeValue: qualityPlan.knowledgeValue,
        readability: qualityPlan.readability,
        duplicateStatus: qualityPlan.duplicateAssessment.status,
        reviewTriggerCount: 1,
      })
    }

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
    const recompilingAcceptedSource = Boolean(input.forceRecompile && previousDedupEntry)
    const bypassContentDedupConfirmation = resolvedContentDedupDecision?.userDecision === 'ingest'
      || resolvedContentDedupDecision?.userDecision === 'keep_both'
      || resolvedContentDedupDecision?.userDecision === 'update'
      || recompilingAcceptedSource

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
    const dedupDecision = await dedupStore.shouldCompile({
      identity: sourceIdentity,
      sourceKind,
      fingerprint,
    })
    const retryingBlockedInboxGate = dedupDecision.action === 'skip'
      && previousDedupEntry?.lastStatus === 'needs_review'
      && Boolean(qualityPath || curationPath)
    const forcingRecompile = dedupDecision.action === 'skip' && Boolean(input.forceRecompile)
    const effectiveDedupDecision = forcingRecompile
      ? { action: 'recompile' as const, reason: 'forced-recompile' as const }
      : retryingBlockedInboxGate
      ? { action: 'recompile' as const, reason: 'inbox-gate-resolved' as const }
      : dedupDecision

    await jobStore.updateStatus(jobId, 'running', {
      step: 'dedup-check',
      sourceIdentity,
      fingerprint,
      dedupDecision: effectiveDedupDecision,
    })

    if (effectiveDedupDecision.action === 'skip') {
      const previousStatus = previousDedupEntry?.lastStatus ?? 'completed'
      return persistResult(previousStatus, effectiveDedupDecision, {
        step: 'dedup-skip',
        sourceIdentity,
        fingerprint,
        skipped: true,
        previousStatus,
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
      dedupDecision: effectiveDedupDecision,
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
    const recordSemanticCurationBlock = async () => {
      await dedupStore.recordSuccess({
        identity: sourceIdentity,
        sourceKind,
        fingerprint,
        jobId,
        status: 'needs_review',
        outputManifest: previousDedupEntry?.lastOutputManifest ?? null,
      })
    }
    if (!curationPath) {
      const reviewResult = await persistReviewItems(config.knowledgeRoot, [{
        id: `${parsedArtifact.id}-semantic-curation-required`,
        artifactId: parsedArtifact.id,
        type: 'semantic-curation-required',
        issueSummary: '需要语义整理计划后才能完成入库。',
        severity: 'medium',
        reason: '缺少 llm-wiki.semantic-curation.v1 curation plan；runtime 不再用规则抽词生成概念/实体页。',
        status: 'open',
        relatedSources: [parsedArtifact.sourceRef],
        relatedPages: [],
        evidence: ['No --curation plan or sidecar curation plan was found.'],
        confidence: 1,
        suggestedActions: [
          '阅读完整原文，按 llm-wiki.semantic-curation.v1 写出 curation JSON。',
          '重新运行 ingest 并传入 --curation <plan.json>，或把 sidecar 放在源文件旁边。',
        ],
      }])
      reviewFiles.push(...reviewResult.files)
      if (lifecycle.stagedPath) {
        lifecycle.retainedPath = await retainReviewableIntake(lifecycle.stagedPath)
      }
      await recordSemanticCurationBlock()
      return persistResult('needs_review', effectiveDedupDecision, {
        step: 'semantic-curation-required',
        sourceIdentity,
        fingerprint,
        reviewTriggerCount: 1,
        entityCount: 0,
        conceptCount: 0,
      })
    }

    let curationPlan
    try {
      curationPlan = validateSemanticCurationPlan({
        artifact: parsedArtifact,
        plan: await loadSemanticCurationPlan(curationPath),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      const reviewResult = await persistReviewItems(config.knowledgeRoot, [{
        id: `${parsedArtifact.id}-semantic-curation-invalid`,
        artifactId: parsedArtifact.id,
        type: 'semantic-curation-invalid',
        issueSummary: '语义整理计划无效，无法完成入库。',
        severity: 'high',
        reason,
        status: 'open',
        relatedSources: [parsedArtifact.sourceRef, curationPath],
        relatedPages: [],
        evidence: [reason],
        confidence: 1,
        suggestedActions: [
          '修正 curation JSON 的 schema、字段、slug 或原文证据 quote。',
          '重新运行 ingest --curation <plan.json>。',
        ],
      }])
      reviewFiles.push(...reviewResult.files)
      if (lifecycle.stagedPath) {
        lifecycle.retainedPath = await retainReviewableIntake(lifecycle.stagedPath)
      }
      await recordSemanticCurationBlock()
      return persistResult('needs_review', effectiveDedupDecision, {
        step: 'semantic-curation-invalid',
        sourceIdentity,
        fingerprint,
        curationPath,
        reviewTriggerCount: 1,
        entityCount: 0,
        conceptCount: 0,
      })
    }

    if (curationPlan.status === 'needs_review') {
      const reasons = semanticCurationNeedsReviewReasons(curationPlan)
      const reviewResult = await persistReviewItems(config.knowledgeRoot, [{
        id: `${parsedArtifact.id}-semantic-curation-blocked`,
        artifactId: parsedArtifact.id,
        type: 'semantic-curation-blocked',
        issueSummary: '本材料暂不能完成普通入库。',
        severity: 'medium',
        reason: reasons.join('; '),
        status: 'open',
        relatedSources: [parsedArtifact.sourceRef, curationPath],
        relatedPages: [],
        evidence: reasons,
        confidence: 1,
        suggestedActions: [
          '根据 curation plan 给出的阻塞原因补证据、改边界、拒绝或暂存。',
          '阻塞解除后重新提交 status=ready 的 curation plan。',
        ],
      }])
      reviewFiles.push(...reviewResult.files)
      if (lifecycle.stagedPath) {
        lifecycle.retainedPath = await retainReviewableIntake(lifecycle.stagedPath)
      }
      await recordSemanticCurationBlock()
      return persistResult('needs_review', effectiveDedupDecision, {
        step: 'semantic-curation-blocked',
        sourceIdentity,
        fingerprint,
        curationPath,
        reviewTriggerCount: 1,
        entityCount: curationPlan.entities.length,
        conceptCount: curationPlan.concepts.length,
      })
    }

    const otherDedupEntries = (await dedupStore.list()).filter((entry) => entry.identity !== sourceIdentity)
    let generation = await generateKnowledgeChanges(parsedArtifact, curationPlan)
    const collisionFreeSourceSlug = resolveCollisionFreeSourceSlug(
      generation.sourcePage.slug,
      parsedArtifact.id,
      otherDedupEntries,
    )

    if (collisionFreeSourceSlug !== generation.sourcePage.slug) {
      generation = await generateKnowledgeChanges(parsedArtifact, curationPlan, { sourceSlug: collisionFreeSourceSlug })
    }

    const ownershipSafeGeneration = await resolveSemanticPageOwnership({
      knowledgeRoot: config.knowledgeRoot,
      generation,
      previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
    })

    const writeResult = await writeKnowledgeChanges({
      knowledgeRoot: config.knowledgeRoot,
      sourcePage: ownershipSafeGeneration.sourcePage,
      readingPage: ownershipSafeGeneration.readingPage,
      entityPages: ownershipSafeGeneration.entityPages,
      conceptPages: ownershipSafeGeneration.conceptPages,
      synthesisPages: ownershipSafeGeneration.synthesisPages,
      logEntry: ownershipSafeGeneration.logMutations.map((mutation) => mutation.value).join('\n'),
      indexEntries: ownershipSafeGeneration.indexMutations.map((mutation) => mutation.value),
      previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
    })
    const semanticLinkResult = await applySourceSemanticLinks({
      knowledgeRoot: config.knowledgeRoot,
      source: {
        slug: ownershipSafeGeneration.sourcePage.slug,
        title: ownershipSafeGeneration.sourcePage.title,
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
    const semanticOverviewResult = await refreshSemanticOverviews({ knowledgeRoot: config.knowledgeRoot })
    writtenFiles.push(
      ...writeResult.writtenFiles,
      ...semanticLinkResult.writtenFiles,
      ...staleDerivedReconciliation.writtenFiles,
      ...semanticPruneResult.writtenFiles,
      ...semanticOverviewResult.writtenFiles,
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
            relatedPages: buildReviewRelatedPages(ownershipSafeGeneration),
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
        relatedPages: buildReviewRelatedPages(ownershipSafeGeneration),
        evidence: effect.evidence ?? [effect.reason],
        confidence: effect.confidence,
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
          pageTarget: `sources/${ownershipSafeGeneration.sourcePage.slug}`,
          pageTitle: ownershipSafeGeneration.sourcePage.title,
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
          pageTarget: `sources/${ownershipSafeGeneration.sourcePage.slug}`,
          pageTitle: ownershipSafeGeneration.sourcePage.title,
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

    const finalStatus = resolveFinalStatus(Boolean(metadataMismatch) || generation.reviewEffects.length > 0)
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
        status: resultStatus,
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
        pageId: `sources/${ownershipSafeGeneration.sourcePage.slug}`,
        chunkCount: indexResult?.chunkCount ?? 0,
        embeddingProvider: contentDedupEmbedding.provider,
        embeddingModel: contentDedupEmbedding.model,
        embeddingVector: contentDedupEmbedding.vector,
      })
    }

    return persistResult(resultStatus, effectiveDedupDecision, {
      step: 'completed',
      sourceIdentity,
      fingerprint,
      qualityPath,
      curationPath,
      reviewTriggerCount: generation.reviewEffects.length + (metadataMismatch ? 1 : 0),
      entityCount: curationPlan.entities.length,
      conceptCount: curationPlan.concepts.length,
      synthesisCount: curationPlan.syntheses.length,
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

type GeneratedKnowledgeChanges = Awaited<ReturnType<typeof generateKnowledgeChanges>>

async function resolveSemanticPageOwnership(input: {
  knowledgeRoot: string
  generation: GeneratedKnowledgeChanges
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<GeneratedKnowledgeChanges> {
  const [entityPages, entityRewrites] = await resolveOwnedSemanticPages({
    knowledgeRoot: input.knowledgeRoot,
    section: 'entities',
    pages: input.generation.entityPages,
    sourceSlug: input.generation.sourcePage.slug,
    previousOutputManifest: input.previousOutputManifest,
  })
  const [conceptPages, conceptRewrites] = await resolveOwnedSemanticPages({
    knowledgeRoot: input.knowledgeRoot,
    section: 'concepts',
    pages: input.generation.conceptPages,
    sourceSlug: input.generation.sourcePage.slug,
    previousOutputManifest: input.previousOutputManifest,
  })
  const [synthesisPages, synthesisRewrites] = await resolveOwnedSemanticPages({
    knowledgeRoot: input.knowledgeRoot,
    section: 'syntheses',
    pages: input.generation.synthesisPages,
    sourceSlug: input.generation.sourcePage.slug,
    previousOutputManifest: input.previousOutputManifest,
  })
  const rewrites = [...entityRewrites, ...conceptRewrites, ...synthesisRewrites]

  return {
    ...input.generation,
    sourcePage: {
      ...input.generation.sourcePage,
      body: rewriteSemanticLinks(input.generation.sourcePage.body, rewrites),
    },
    entityPages,
    conceptPages,
    synthesisPages,
    indexMutations: input.generation.indexMutations.map((mutation) => ({
      ...mutation,
      value: rewriteSemanticLinks(mutation.value, rewrites),
    })),
  }
}

async function resolveOwnedSemanticPages(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  pages: GeneratedKnowledgeChanges['entityPages']
  sourceSlug: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<[GeneratedKnowledgeChanges['entityPages'], SemanticPageRewrite[]]> {
  const resolvedPages: GeneratedKnowledgeChanges['entityPages'] = []
  const rewrites: SemanticPageRewrite[] = []
  const reservedSlugs = new Set(input.pages.map((page) => page.slug))

  for (const page of input.pages) {
    const owned = await isPageWritableByCurrentSource({
      knowledgeRoot: input.knowledgeRoot,
      section: input.section,
      slug: page.slug,
      previousOutputManifest: input.previousOutputManifest,
    })
    if (owned) {
      resolvedPages.push(page)
      continue
    }

    const nextSlug = await nextSourceScopedSemanticSlug({
      knowledgeRoot: input.knowledgeRoot,
      section: input.section,
      baseSlug: page.slug,
      sourceSlug: input.sourceSlug,
      previousOutputManifest: input.previousOutputManifest,
      reservedSlugs,
    })
    reservedSlugs.add(nextSlug)
    resolvedPages.push({ ...page, slug: nextSlug })
    rewrites.push({ section: input.section, fromSlug: page.slug, toSlug: nextSlug, title: page.title })
  }

  return [resolvedPages, rewrites]
}

async function isPageWritableByCurrentSource(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  slug: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<boolean> {
  const relativePath = `wiki/${input.section}/${input.slug}.md`
  if (manifestOwnsPage(input.previousOutputManifest, relativePath)) {
    if (await isManifestOwnedSemanticPageUnmodified({
      knowledgeRoot: input.knowledgeRoot,
      relativePath,
      previousOutputManifest: input.previousOutputManifest,
    })) {
      return true
    }
    return false
  }
  if (!(await fileExists(path.join(input.knowledgeRoot, relativePath)))) {
    return true
  }
  if (input.section === 'syntheses') {
    return false
  }
  return isManagedSemanticPage({
    knowledgeRoot: input.knowledgeRoot,
    section: input.section,
    slug: input.slug,
  })
}

async function isManagedSemanticPage(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  slug: string
}): Promise<boolean> {
  let markdown: string
  try {
    markdown = await readFile(path.join(input.knowledgeRoot, 'wiki', input.section, `${input.slug}.md`), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }

  const typeBySection = {
    entities: 'entity',
    concepts: 'concept',
    syntheses: 'synthesis',
  } as const
  return hasManagedSemanticFrontmatter(markdown, typeBySection[input.section])
}

async function nextSourceScopedSemanticSlug(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  baseSlug: string
  sourceSlug: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
  reservedSlugs: Set<string>
}): Promise<string> {
  const base = `${input.baseSlug}-${input.sourceSlug}`
  for (let counter = 1; counter < 100; counter += 1) {
    const slug = counter === 1 ? base : `${base}-${counter}`
    const relativePath = `wiki/${input.section}/${slug}.md`
    if (input.reservedSlugs.has(slug)) {
      continue
    }
    if (manifestOwnsPage(input.previousOutputManifest, relativePath)) {
      if (await isManifestOwnedSemanticPageUnmodified({
        knowledgeRoot: input.knowledgeRoot,
        relativePath,
        previousOutputManifest: input.previousOutputManifest,
      })) {
        return slug
      }
      continue
    }
    if (!(await fileExists(path.join(input.knowledgeRoot, relativePath)))) {
      return slug
    }
  }
  throw new Error(`Unable to choose non-conflicting semantic page slug for ${input.section}/${input.baseSlug}`)
}

function manifestOwnsPage(manifest: DedupEntry['lastOutputManifest'], relativePath: string): boolean {
  return Boolean(
    manifest?.pageFiles.includes(relativePath)
    || manifest?.pageSnapshots.some((snapshot) => snapshot.filePath === relativePath),
  )
}

function hasManagedSemanticFrontmatter(markdown: string, type: 'entity' | 'concept' | 'synthesis'): boolean {
  return new RegExp(`^---\\n[\\s\\S]*\\ntype: ${JSON.stringify(type)}\\n[\\s\\S]*\\n---\\n?`, 'u').test(markdown)
}

async function isManifestOwnedSemanticPageUnmodified(input: {
  knowledgeRoot: string
  relativePath: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<boolean> {
  const snapshot = input.previousOutputManifest?.pageSnapshots.find((candidate) => candidate.filePath === input.relativePath)
  if (!snapshot) {
    return false
  }

  let currentMarkdown: string
  try {
    currentMarkdown = await readFile(path.join(input.knowledgeRoot, input.relativePath), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true
    }
    throw error
  }

  if (snapshot.body.trimStart().startsWith('---\n')) {
    return currentMarkdown.trimEnd() === snapshot.body.trimEnd()
  }

  return stripWikiFrontmatter(currentMarkdown).trimEnd() === snapshot.body.trimEnd()
}

function stripWikiFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) {
    return markdown
  }
  const end = markdown.indexOf('\n---\n', 4)
  if (end < 0) {
    return markdown
  }
  return markdown.slice(end + '\n---\n'.length)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

type SemanticPageSection = 'entities' | 'concepts' | 'syntheses'
type SemanticPageRewrite = { section: SemanticPageSection; fromSlug: string; toSlug: string; title: string }

function rewriteSemanticLinks(
  value: string,
  rewrites: SemanticPageRewrite[],
): string {
  return rewrites.reduce((current, rewrite) => {
    const from = `[[${rewrite.section}/${rewrite.fromSlug}|${rewrite.title}]]`
    const to = `[[${rewrite.section}/${rewrite.toSlug}|${rewrite.title}]]`
    return current.split(from).join(to)
  }, value)
}

function buildReviewRelatedPages(generation: GeneratedKnowledgeChanges): string[] {
  return [
    `sources/${generation.sourcePage.slug}`,
    ...generation.entityPages.map((page) => `entities/${page.slug}`),
    ...generation.conceptPages.map((page) => `concepts/${page.slug}`),
    ...generation.synthesisPages.map((page) => `syntheses/${page.slug}`),
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

function shouldRecordSuccessfulManifest(status: JobStatus): status is Extract<JobStatus, 'completed' | 'needs_review' | 'partial'> {
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
  const retainedHumanEditedFiles = new Set<string>()
  const writtenFiles: string[] = []
  for (const filePath of staleDerivedFiles) {
    const remainingOwners = await collectDerivedPageOwners({
      entries: input.otherEntries,
      filePath,
    })

    if (remainingOwners.length === 0) {
      if (!(await isManifestOwnedSemanticPageUnmodified({
        knowledgeRoot: input.knowledgeRoot,
        relativePath: filePath,
        previousOutputManifest: previousManifest,
      }))) {
        retainedHumanEditedFiles.add(filePath)
        continue
      }
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
    (entry) => {
      const targetFile = semanticIndexEntryTargetFile(entry)
      return !input.currentOutputManifest.indexEntries.includes(entry)
        && !isSourceOwnedIndexEntry(entry)
        && !(targetFile && retainedHumanEditedFiles.has(targetFile))
    },
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
  return normalized.startsWith('wiki/entities/') || normalized.startsWith('wiki/concepts/') || normalized.startsWith('wiki/syntheses/')
}

function isSourceOwnedIndexEntry(entry: string): boolean {
  return /^[-*]\s+\[\[sources\/[^|\]]+\|[^\]]+\]\]$/.test(entry.trim())
}

function semanticIndexEntryTargetFile(entry: string): string | null {
  const match = entry.trim().match(/^[-*]\s+\[\[((?:entities|concepts|syntheses)\/[^|\]]+)\|[^\]]+\]\]$/)
  return match ? `wiki/${match[1]}.md` : null
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

async function findSemanticCurationSidecar(source: string): Promise<string | null> {
  const candidates = [
    `${source}.curation.json`,
    path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.curation.json`),
    path.join(path.dirname(source), '_curation', `${path.basename(source, path.extname(source))}.json`),
  ]

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate
    }
  }
  return null
}

async function findInboxQualitySidecar(source: string): Promise<string | null> {
  const candidates = [
    `${source}.quality.json`,
    path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.quality.json`),
    path.join(path.dirname(source), '_quality', `${path.basename(source, path.extname(source))}.json`),
  ]

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate
    }
  }
  return null
}

function resolveFailureStatus(sourceKind: DiscoveredSourceKind, error: unknown): JobStatus {
  if (sourceKind === 'url' && classifyUrlFailure(error).retryable) {
    return 'failed_retryable'
  }

  return 'failed_terminal'
}
