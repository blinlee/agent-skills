import { loadSemanticCurationPlan, semanticCurationNeedsReviewReasons, validateSemanticCurationPlan, } from '../compile/semantic-curation.js';
import { persistReviewItems } from '../governance/review.js';
import { retainReviewableIntake } from '../intake/lifecycle.js';
export async function runSemanticCurationPhase(input) {
    const recordSemanticCurationBlock = async () => {
        await input.dedupStore.recordSuccess({
            identity: input.sourceIdentity,
            sourceKind: input.sourceKind,
            fingerprint: input.fingerprint,
            jobId: input.jobId,
            status: 'needs_review',
            outputManifest: input.previousOutputManifest,
        });
    };
    const retainIfNeeded = async () => input.stagedPath ? retainReviewableIntake(input.stagedPath) : null;
    if (!input.curationPath) {
        const reviewResult = await persistReviewItems(input.knowledgeRoot, [{
                id: `${input.artifact.id}-semantic-curation-required`,
                artifactId: input.artifact.id,
                type: 'semantic-curation-required',
                issueSummary: '需要语义整理计划后才能完成入库。',
                severity: 'medium',
                reason: '缺少 llm-wiki.semantic-curation.v1 curation plan；runtime 不再用规则抽词生成概念/实体页。',
                status: 'open',
                relatedSources: [input.artifact.sourceRef],
                relatedPages: [],
                evidence: ['No --curation plan or sidecar curation plan was found.'],
                confidence: 1,
                suggestedActions: [
                    '阅读完整原文，按 llm-wiki.semantic-curation.v1 写出 curation JSON。',
                    '重新运行 ingest 并传入 --curation <plan.json>，或把 sidecar 放在源文件旁边。',
                ],
            }]);
        await recordSemanticCurationBlock();
        return {
            status: 'needs_review',
            reviewFiles: reviewResult.files,
            retainedPath: await retainIfNeeded(),
            details: {
                step: 'semantic-curation-required',
                sourceIdentity: input.sourceIdentity,
                fingerprint: input.fingerprint,
                reviewTriggerCount: 1,
                entityCount: 0,
                conceptCount: 0,
            },
        };
    }
    let curationPlan;
    try {
        curationPlan = validateSemanticCurationPlan({
            artifact: input.artifact,
            plan: await loadSemanticCurationPlan(input.curationPath),
        });
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const reviewResult = await persistReviewItems(input.knowledgeRoot, [{
                id: `${input.artifact.id}-semantic-curation-invalid`,
                artifactId: input.artifact.id,
                type: 'semantic-curation-invalid',
                issueSummary: '语义整理计划无效，无法完成入库。',
                severity: 'high',
                reason,
                status: 'open',
                relatedSources: [input.artifact.sourceRef, input.curationPath],
                relatedPages: [],
                evidence: [reason],
                confidence: 1,
                suggestedActions: [
                    '修正 curation JSON 的 schema、字段、slug 或原文证据 quote。',
                    '重新运行 ingest --curation <plan.json>。',
                ],
            }]);
        await recordSemanticCurationBlock();
        return {
            status: 'needs_review',
            reviewFiles: reviewResult.files,
            retainedPath: await retainIfNeeded(),
            details: {
                step: 'semantic-curation-invalid',
                sourceIdentity: input.sourceIdentity,
                fingerprint: input.fingerprint,
                curationPath: input.curationPath,
                reviewTriggerCount: 1,
                entityCount: 0,
                conceptCount: 0,
            },
        };
    }
    if (curationPlan.status === 'needs_review') {
        const reasons = semanticCurationNeedsReviewReasons(curationPlan);
        const reviewResult = await persistReviewItems(input.knowledgeRoot, [{
                id: `${input.artifact.id}-semantic-curation-blocked`,
                artifactId: input.artifact.id,
                type: 'semantic-curation-blocked',
                issueSummary: '本材料暂不能完成普通入库。',
                severity: 'medium',
                reason: reasons.join('; '),
                status: 'open',
                relatedSources: [input.artifact.sourceRef, input.curationPath],
                relatedPages: [],
                evidence: reasons,
                confidence: 1,
                suggestedActions: [
                    '根据 curation plan 给出的阻塞原因补证据、改边界、拒绝或暂存。',
                    '阻塞解除后重新提交 status=ready 的 curation plan。',
                ],
            }]);
        await recordSemanticCurationBlock();
        return {
            status: 'needs_review',
            reviewFiles: reviewResult.files,
            retainedPath: await retainIfNeeded(),
            details: {
                step: 'semantic-curation-blocked',
                sourceIdentity: input.sourceIdentity,
                fingerprint: input.fingerprint,
                curationPath: input.curationPath,
                reviewTriggerCount: 1,
                entityCount: curationPlan.entities.length,
                conceptCount: curationPlan.concepts.length,
            },
        };
    }
    return { status: 'ready', curationPlan };
}
