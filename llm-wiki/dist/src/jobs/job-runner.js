import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { generateKnowledgeChanges } from '../compile/generation.js';
import { loadConfig } from '../config.js';
import { persistReviewItems, removeStaleReviewFiles } from '../governance/review.js';
import { applyTaxonomyEffects } from '../governance/taxonomy.js';
import { createEmptyLifecycleState, retainReviewableIntake, stageIntakeFile, stageNormalizedArtifact, archiveStagedFile, rejectIntakeFile, } from '../intake/lifecycle.js';
import { contentDedupIndexPath, createContentDedupStore } from '../intake/content-dedup-store.js';
import { createDedupStore } from '../intake/dedup-store.js';
import { backfillDedupManifestPageSnapshots } from '../intake/manifest-migration.js';
import { detectSourceMetadataMismatch } from '../intake/mismatch-gate.js';
import { classifySource, isSupportedSourceKind } from '../intake/source-discovery.js';
import { createJobStore } from './job-store.js';
import { ensureKnowledgeRootLayout } from '../paths.js';
import { writeKnowledgeChanges } from '../wiki/page-writer.js';
import { applySourceSemanticLinks, pruneMissingSourceSemanticLinks } from '../wiki/semantic-links.js';
import { refreshSemanticOverviews } from '../wiki/semantic-overviews.js';
import { runBuildIndex } from '../index/wiki-index.js';
import { runEntityExtraction } from '../retrieval/entity-extract.js';
import { keyInfoIndexPath, runKeyInfoExtraction } from '../retrieval/key-info.js';
import { runIngestEmbedIndex, summarizeEmbeddingResult, summarizeIndexResult } from './ingest-indexing.js';
import { buildReviewRelatedPages, reconcileStaleDerivedOutputs, resolveSemanticPageOwnership } from './semantic-derived-pages.js';
import { runSemanticCurationPhase } from './curation-phase.js';
import { runInboxQualityPhase } from './quality-phase.js';
import { runContentDedupPhase } from './content-dedup-phase.js';
import { buildStableSourceId, findInboxQualitySidecar, findSemanticCurationSidecar, isLocalFileCandidate, normalizeSourceIdentity, parseSource, prepareSourceForDedup, resolveCollisionFreeSourceSlug, resolveFailureStatus, resolveFinalStatus, } from './source-preparation.js';
export async function runIngestJob(input) {
    const config = loadConfig({
        knowledgeRoot: input.knowledgeRoot,
        jobStorePath: path.join(path.resolve(input.knowledgeRoot), 'system', 'jobs', 'jobs.json'),
    });
    await ensureKnowledgeRootLayout(config.knowledgeRoot);
    const dedupManifestPath = path.join(config.knowledgeRoot, 'system', 'dedup', 'manifest.json');
    await backfillDedupManifestPageSnapshots({
        knowledgeRoot: config.knowledgeRoot,
        manifestPath: dedupManifestPath,
    });
    const jobStore = createJobStore(config.jobStorePath);
    const dedupStore = createDedupStore(dedupManifestPath);
    const contentDedupStore = createContentDedupStore(contentDedupIndexPath(config.knowledgeRoot));
    const sourceKind = classifySource(input.input);
    const lifecycle = createEmptyLifecycleState();
    const writtenFiles = [];
    const reviewFiles = [];
    const taxonomyFiles = [];
    const jobId = randomUUID();
    await jobStore.save({
        id: jobId,
        status: 'queued',
        sourceKind,
        sourceRef: input.input,
        details: {
            step: 'queued',
        },
    });
    const persistResult = async (status, dedupDecision, details = {}) => {
        const index = details.index;
        const embedding = details.embedding;
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
        });
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
        };
    };
    try {
        await jobStore.updateStatus(jobId, 'running', { step: 'discover-source', input: input.input, sourceKind });
        if (!isSupportedSourceKind(sourceKind)) {
            lifecycle.rejectedPath = await rejectIntakeFile({
                knowledgeRoot: config.knowledgeRoot,
                inputPath: input.input,
                jobId,
                sourceKind: 'unknown',
            });
            return persistResult('rejected', null, {
                step: 'rejected',
                reason: 'unsupported-source-kind',
            });
        }
        const sourceIdentity = normalizeSourceIdentity(sourceKind, input.input);
        const previousDedupEntry = await dedupStore.get(sourceIdentity);
        const preparedSource = await prepareSourceForDedup({
            sourceKind,
            input: input.input,
            sourceId: buildStableSourceId(sourceKind, sourceIdentity),
            stagedPath: lifecycle.stagedPath,
            urlFetchTimeoutMs: config.urlFetchTimeoutMs,
            repoSampleLimit: config.repoSamplingLimits.maxFiles,
        });
        const { fingerprint } = preparedSource;
        const parsedArtifactForDedup = preparedSource.parsedArtifact ?? await parseSource({
            sourceKind,
            input: input.input,
            sourceId: buildStableSourceId(sourceKind, sourceIdentity),
            stagedPath: null,
            urlFetchTimeoutMs: config.urlFetchTimeoutMs,
            repoSampleLimit: config.repoSamplingLimits.maxFiles,
        });
        const qualityPath = input.qualityPath ?? await findInboxQualitySidecar(input.input);
        const curationPath = input.curationPath ?? await findSemanticCurationSidecar(input.input);
        const qualityPhase = await runInboxQualityPhase({
            knowledgeRoot: config.knowledgeRoot,
            artifact: parsedArtifactForDedup,
            qualityPath,
            sourceIdentity,
            sourceKind,
            fingerprint,
            jobId,
            previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
            dedupStore,
        });
        if (qualityPhase.status === 'needs_review') {
            reviewFiles.push(...qualityPhase.reviewFiles);
            return persistResult('needs_review', null, qualityPhase.details);
        }
        const contentDedupPhase = await runContentDedupPhase({
            contentDedupStore,
            dedupStore,
            sourceIdentity,
            sourceKind,
            title: parsedArtifactForDedup.title,
            content: parsedArtifactForDedup.content,
            fingerprint,
            previousDedupEntry,
            forceRecompile: input.forceRecompile,
            qualityPath,
            curationPath,
        });
        if (contentDedupPhase.status !== 'ready') {
            return persistResult(contentDedupPhase.status, contentDedupPhase.dedupDecision, contentDedupPhase.details);
        }
        const { contentDedupCheck, contentDedupEmbedding, resolvedContentDedupDecision, effectiveDedupDecision, } = contentDedupPhase;
        await jobStore.updateStatus(jobId, 'running', {
            step: 'dedup-check',
            sourceIdentity,
            fingerprint,
            dedupDecision: effectiveDedupDecision,
        });
        if (effectiveDedupDecision.action === 'skip') {
            const previousStatus = previousDedupEntry?.lastStatus ?? 'completed';
            return persistResult(previousStatus, effectiveDedupDecision, {
                step: 'dedup-skip',
                sourceIdentity,
                fingerprint,
                skipped: true,
                previousStatus,
            });
        }
        if (sourceKind === 'md' || sourceKind === 'txt') {
            lifecycle.stagedPath = await stageIntakeFile({
                knowledgeRoot: config.knowledgeRoot,
                inputPath: input.input,
                jobId,
                sourceKind,
            });
        }
        await jobStore.updateStatus(jobId, 'running', {
            step: 'parse-source',
            sourceIdentity,
            fingerprint,
            dedupDecision: effectiveDedupDecision,
            stagedPath: lifecycle.stagedPath,
        });
        const parsedArtifact = parsedArtifactForDedup;
        if (!lifecycle.stagedPath && (sourceKind === 'url' || sourceKind === 'repo')) {
            lifecycle.stagedPath = await stageNormalizedArtifact({
                knowledgeRoot: config.knowledgeRoot,
                jobId,
                sourceKind,
                sourceRef: input.input,
                title: parsedArtifact.title,
                content: parsedArtifact.content,
            });
        }
        const metadataMismatch = detectSourceMetadataMismatch(parsedArtifact);
        const curationPhase = await runSemanticCurationPhase({
            knowledgeRoot: config.knowledgeRoot,
            artifact: parsedArtifact,
            curationPath,
            stagedPath: lifecycle.stagedPath,
            sourceIdentity,
            sourceKind,
            fingerprint,
            jobId,
            previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
            dedupStore,
        });
        if (curationPhase.status === 'needs_review') {
            reviewFiles.push(...curationPhase.reviewFiles);
            lifecycle.retainedPath = curationPhase.retainedPath;
            return persistResult('needs_review', effectiveDedupDecision, curationPhase.details);
        }
        const curationPlan = curationPhase.curationPlan;
        const otherDedupEntries = (await dedupStore.list()).filter((entry) => entry.identity !== sourceIdentity);
        let generation = await generateKnowledgeChanges(parsedArtifact, curationPlan);
        const collisionFreeSourceSlug = resolveCollisionFreeSourceSlug(generation.sourcePage.slug, parsedArtifact.id, otherDedupEntries);
        if (collisionFreeSourceSlug !== generation.sourcePage.slug) {
            generation = await generateKnowledgeChanges(parsedArtifact, curationPlan, { sourceSlug: collisionFreeSourceSlug });
        }
        const ownershipSafeGeneration = await resolveSemanticPageOwnership({
            knowledgeRoot: config.knowledgeRoot,
            generation,
            previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
        });
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
        });
        const semanticLinkResult = await applySourceSemanticLinks({
            knowledgeRoot: config.knowledgeRoot,
            source: {
                slug: ownershipSafeGeneration.sourcePage.slug,
                title: ownershipSafeGeneration.sourcePage.title,
            },
        });
        const staleDerivedReconciliation = await reconcileStaleDerivedOutputs({
            knowledgeRoot: config.knowledgeRoot,
            previousOutputManifest: previousDedupEntry?.lastOutputManifest ?? null,
            currentOutputManifest: writeResult.outputManifest,
            otherEntries: otherDedupEntries,
        });
        const semanticPruneResult = await pruneMissingSourceSemanticLinks(config.knowledgeRoot);
        const semanticOverviewResult = await refreshSemanticOverviews({ knowledgeRoot: config.knowledgeRoot });
        writtenFiles.push(...writeResult.writtenFiles, ...semanticLinkResult.writtenFiles, ...staleDerivedReconciliation.writtenFiles, ...semanticPruneResult.writtenFiles, ...semanticOverviewResult.writtenFiles);
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
        ];
        if (reviewArtifacts.length > 0) {
            const reviewResult = await persistReviewItems(config.knowledgeRoot, reviewArtifacts);
            reviewFiles.push(...reviewResult.files);
        }
        const currentReviewManifest = reviewFiles.map((filePath) => path.relative(config.knowledgeRoot, filePath));
        await removeStaleReviewFiles(config.knowledgeRoot, previousDedupEntry?.lastOutputManifest?.reviewFiles ?? [], currentReviewManifest);
        if (generation.taxonomyEffects.length > 0) {
            const taxonomyResult = await applyTaxonomyEffects(config.knowledgeRoot, {
                topicProposals: generation.taxonomyEffects.map((effect) => ({
                    name: effect.title,
                    confidence: effect.confidence,
                    rationale: effect.rationale,
                    sources: [effect.source],
                })),
            });
            taxonomyFiles.push(...taxonomyResult.files);
        }
        let entityExtractionResult = null;
        if (input.extractEntities) {
            try {
                entityExtractionResult = await runEntityExtraction({
                    knowledgeRoot: config.knowledgeRoot,
                    artifact: parsedArtifact,
                    pageTarget: `sources/${ownershipSafeGeneration.sourcePage.slug}`,
                    pageTitle: ownershipSafeGeneration.sourcePage.title,
                    sourceIdentity,
                    sourceKind,
                });
                if (entityExtractionResult.status === 'extracted') {
                    writtenFiles.push(entityExtractionResult.filePath);
                }
            }
            catch (error) {
                entityExtractionResult = {
                    status: 'skipped',
                    reason: `entity extraction failed: ${error.message}`,
                    filePath: path.join(config.knowledgeRoot, 'system', 'index', 'entity-extractions.json'),
                };
            }
        }
        let keyInfoExtractionResult = null;
        if (input.extractKeyInfo) {
            try {
                keyInfoExtractionResult = await runKeyInfoExtraction({
                    knowledgeRoot: config.knowledgeRoot,
                    artifact: parsedArtifact,
                    pageTarget: `sources/${ownershipSafeGeneration.sourcePage.slug}`,
                    pageTitle: ownershipSafeGeneration.sourcePage.title,
                    sourceIdentity,
                    sourceKind,
                });
                if (keyInfoExtractionResult.status === 'extracted') {
                    writtenFiles.push(keyInfoExtractionResult.filePath);
                }
            }
            catch (error) {
                keyInfoExtractionResult = {
                    status: 'skipped',
                    reason: `key_info extraction failed: ${error.message}`,
                    filePath: keyInfoIndexPath(config.knowledgeRoot),
                };
            }
        }
        let indexResult = null;
        let embedResult = null;
        let indexFailure = null;
        let embeddingFailure = null;
        let embeddingSkippedReason = null;
        const finalStatus = resolveFinalStatus(Boolean(metadataMismatch) || generation.reviewEffects.length > 0);
        let resultStatus = finalStatus;
        const outputManifest = {
            ...writeResult.outputManifest,
            reviewFiles: currentReviewManifest,
        };
        if (finalStatus === 'completed') {
            if (lifecycle.stagedPath) {
                lifecycle.archivePath = await archiveStagedFile(config.knowledgeRoot, lifecycle.stagedPath);
                lifecycle.stagedPath = null;
            }
        }
        else if (lifecycle.stagedPath) {
            lifecycle.retainedPath = await retainReviewableIntake(lifecycle.stagedPath);
        }
        // Rebuild after raw lifecycle finalization so raw-backed citations do not
        // point at stale staged paths once a completed source moves to archive.
        try {
            indexResult = await runBuildIndex({ knowledgeRoot: config.knowledgeRoot });
            try {
                const optionalEmbedResult = await runIngestEmbedIndex(config.knowledgeRoot);
                embedResult = optionalEmbedResult.result;
                embeddingSkippedReason = optionalEmbedResult.skippedReason;
            }
            catch (error) {
                embeddingFailure = error instanceof Error ? error.message : String(error);
                // embedding is optional; do not fail the ingest
            }
        }
        catch (error) {
            indexFailure = error instanceof Error ? error.message : String(error);
            resultStatus = finalStatus === 'completed' ? 'partial' : finalStatus;
        }
        if (shouldRecordSuccessfulManifest(resultStatus)) {
            await dedupStore.recordSuccess({
                identity: sourceIdentity,
                sourceKind,
                fingerprint,
                jobId,
                status: resultStatus,
                outputManifest,
            });
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
            });
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
                },
            } : {}),
            ...(embedResult ? {
                embedding: summarizeEmbeddingResult(embedResult),
            } : embeddingSkippedReason ? {
                embedding: {
                    status: 'skipped',
                    reason: embeddingSkippedReason,
                },
            } : embeddingFailure ? {
                embedding: {
                    status: 'failed',
                    error: embeddingFailure,
                },
            } : {}),
        });
    }
    catch (error) {
        if (!lifecycle.rejectedPath && isLocalFileCandidate(sourceKind)) {
            lifecycle.rejectedPath = await rejectIntakeFile({
                knowledgeRoot: config.knowledgeRoot,
                inputPath: input.input,
                jobId,
                sourceKind: isSupportedSourceKind(sourceKind) ? sourceKind : 'unknown',
                stagedPath: lifecycle.stagedPath,
            });
            lifecycle.stagedPath = null;
        }
        return persistResult(resolveFailureStatus(sourceKind, error), null, {
            step: 'failed',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
function buildDefaultReviewSuggestedActions(kind) {
    if (kind === 'low-confidence') {
        return ['低置信候选仅作为治理信号处理；确认后再决定是否批准、合并、重命名或拒绝。'];
    }
    if (kind === 'semantic-candidate') {
        return ['在创建稳定 wiki 语义前，先判断该候选是否应被批准、合并、重命名或拒绝。'];
    }
    if (kind === 'ambiguous-classification') {
        return ['先解决分类歧义，再提升为稳定 taxonomy 或 wiki 结构。'];
    }
    if (kind === 'source-metadata-mismatch') {
        return ['先核对文件名、URL、标题与正文是否属于同一来源；不一致时修正或隔离来源后再重新摄入。'];
    }
    if (kind === 'sparse-artifact') {
        return ['补充来源证据，或明确标记该材料本来就是稀疏材料。'];
    }
    return ['判断该事项是否应该改变稳定 wiki 或 taxonomy 状态。'];
}
function shouldRecordSuccessfulManifest(status) {
    return status === 'completed' || status === 'needs_review' || status === 'partial';
}
