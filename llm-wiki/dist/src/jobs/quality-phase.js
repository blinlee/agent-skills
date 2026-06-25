import { persistReviewItems } from '../governance/review.js';
import { inboxQualityNeedsReviewReasons, loadInboxQualityPlan, validateInboxQualityPlan, } from '../intake/quality-gate.js';
export async function runInboxQualityPhase(input) {
    const recordQualityBlock = async () => {
        await input.dedupStore.recordSuccess({
            identity: input.sourceIdentity,
            sourceKind: input.sourceKind,
            fingerprint: input.fingerprint,
            jobId: input.jobId,
            status: 'needs_review',
            outputManifest: input.previousOutputManifest,
        });
    };
    if (!input.qualityPath) {
        const reviewResult = await persistReviewItems(input.knowledgeRoot, [{
                id: `${input.artifact.id}-inbox-quality-required`,
                artifactId: input.artifact.id,
                type: 'inbox-quality-required',
                issueSummary: '需要入库质量判断后才能完成入库。',
                severity: 'medium',
                reason: '缺少 llm-wiki.inbox-quality.v1 quality plan；inbox 必须先判断重复、可读性、垃圾/噪声、知识价值和建议动作。',
                status: 'open',
                relatedSources: [input.artifact.sourceRef],
                relatedPages: [],
                evidence: ['No --quality plan or sidecar quality plan was found.'],
                confidence: 1,
                suggestedActions: [
                    '阅读规范化原文，按 llm-wiki.inbox-quality.v1 写出 quality JSON。',
                    '如果材料应收入，decision=accept 后重新运行 ingest/route-accept 并传入 --quality <plan.json>。',
                    '如果材料应拒收、暂存、转换或合并，先让用户批准对应动作。',
                ],
            }]);
        await recordQualityBlock();
        return {
            status: 'needs_review',
            reviewFiles: reviewResult.files,
            details: {
                step: 'inbox-quality-required',
                sourceIdentity: input.sourceIdentity,
                fingerprint: input.fingerprint,
                reviewTriggerCount: 1,
            },
        };
    }
    let qualityPlan;
    try {
        qualityPlan = validateInboxQualityPlan({
            artifact: input.artifact,
            plan: await loadInboxQualityPlan(input.qualityPath),
        });
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const reviewResult = await persistReviewItems(input.knowledgeRoot, [{
                id: `${input.artifact.id}-inbox-quality-invalid`,
                artifactId: input.artifact.id,
                type: 'inbox-quality-invalid',
                issueSummary: '入库质量判断无效，无法完成入库。',
                severity: 'high',
                reason,
                status: 'open',
                relatedSources: [input.artifact.sourceRef, input.qualityPath],
                relatedPages: [],
                evidence: [reason],
                confidence: 1,
                suggestedActions: [
                    '修正 quality JSON 的 schema、字段、枚举或原文证据 quote。',
                    '重新运行 ingest/route-accept --quality <plan.json>。',
                ],
            }]);
        await recordQualityBlock();
        return {
            status: 'needs_review',
            reviewFiles: reviewResult.files,
            details: {
                step: 'inbox-quality-invalid',
                sourceIdentity: input.sourceIdentity,
                fingerprint: input.fingerprint,
                qualityPath: input.qualityPath,
                reviewTriggerCount: 1,
            },
        };
    }
    if (qualityPlan.status === 'needs_review' || qualityPlan.decision !== 'accept') {
        const reasons = inboxQualityNeedsReviewReasons(qualityPlan);
        const reviewResult = await persistReviewItems(input.knowledgeRoot, [{
                id: `${input.artifact.id}-inbox-quality-blocked`,
                artifactId: input.artifact.id,
                type: 'inbox-quality-blocked',
                issueSummary: '本材料未通过入库质量门槛。',
                severity: qualityPlan.decision === 'reject' ? 'high' : 'medium',
                reason: reasons.join('; ') || qualityPlan.reason,
                status: 'open',
                relatedSources: [input.artifact.sourceRef, input.qualityPath],
                relatedPages: [],
                evidence: qualityPlan.evidence.map((evidence) => evidence.quote),
                confidence: 1,
                suggestedActions: [
                    `建议动作：${qualityPlan.decision}`,
                    '向用户展示质量判断，等待批准 reject / park / convert / merge / accept 之一。',
                    '只有改为 decision=accept 且语义整理也有效时，才继续普通入库。',
                ],
            }]);
        await recordQualityBlock();
        return {
            status: 'needs_review',
            reviewFiles: reviewResult.files,
            details: {
                step: 'inbox-quality-blocked',
                sourceIdentity: input.sourceIdentity,
                fingerprint: input.fingerprint,
                qualityPath: input.qualityPath,
                qualityDecision: qualityPlan.decision,
                knowledgeValue: qualityPlan.knowledgeValue,
                readability: qualityPlan.readability,
                duplicateStatus: qualityPlan.duplicateAssessment.status,
                reviewTriggerCount: 1,
            },
        };
    }
    return { status: 'ready', qualityPlan };
}
