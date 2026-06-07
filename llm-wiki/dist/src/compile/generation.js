export async function generateKnowledgeChanges(analysis, options = {}) {
    const sourceSlug = options.sourceSlug ?? buildStableArtifactSlug(analysis);
    const entityCandidates = removeSourceTitleHeuristics(analysis.candidateEntities, sourceSlug);
    const conceptCandidates = removeSourceTitleHeuristics(analysis.candidateConcepts, sourceSlug);
    const sourcePage = {
        slug: sourceSlug,
        title: analysis.artifact.title,
        artifactId: analysis.artifactId,
        topics: [],
        backlinks: [],
        body: buildSourcePageBody(analysis),
    };
    const entityPages = [];
    const conceptPages = [];
    const synthesisSuggestions = [];
    const indexMutations = buildIndexMutations(sourcePage, entityPages, conceptPages);
    const logMutations = [{
            target: 'wiki/log.md',
            op: 'append',
            value: `${analysis.artifact.updatedAt}\tcompiled\t${analysis.artifactId}\t${sourceSlug}`,
        }];
    return {
        artifactId: analysis.artifactId,
        sourcePage,
        entityPages,
        conceptPages,
        synthesisSuggestions,
        indexMutations,
        logMutations,
        taxonomyEffects: buildTaxonomyEffects(analysis.topics, sourcePage),
        reviewEffects: buildReviewEffects(analysis, entityCandidates, conceptCandidates),
    };
}
function buildSourcePageBody(analysis) {
    return [
        `# ${analysis.artifact.title}`,
        '',
        `- 资料 ID: ${analysis.artifactId}`,
        `- 来源类型: ${sourceKindLabel(analysis.artifact.sourceKind)}`,
        `- 来源引用: ${analysis.artifact.sourceRef}`,
        `- 分析置信度: ${analysis.confidence}`,
        '',
        '## 摘要',
        buildFastReadSummary(analysis),
        '',
        '## 证据说明',
        '原始采集材料是事实依据。本页是派生的索引和速读摘要，用于定位与浏览，不能替代原始证据。',
        '',
        '候选语义会先保存在内部提案状态中；未经批准的候选项不会从本页直接写成稳定链接。',
        '',
        '### 原文证据片段',
        ...selectVerbatimEvidenceSamples(analysis.artifact.content).map((line) => `- ${line}`),
        '',
        '### 注意点 / 边界信号',
        ...selectCaveatSignals(analysis.artifact.content),
        '',
        '## 原文摘录',
        analysis.artifact.content.slice(0, 1200),
    ].join('\n');
}
function buildFastReadSummary(analysis) {
    return `这是一份${sourceKindLabel(analysis.artifact.sourceKind)}来源材料，标题为《${analysis.artifact.title}》。当前编译置信度为 ${analysis.confidence}。本页用于快速了解资料身份、证据位置和后续治理状态；具体论断请以下方原文摘录和归档原始材料为准。`;
}
function sourceKindLabel(sourceKind) {
    const labels = {
        md: 'Markdown',
        txt: '文本',
        url: '网页',
        repo: '代码仓库',
    };
    return labels[sourceKind];
}
function selectVerbatimEvidenceSamples(content) {
    const candidates = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .filter((line) => !/^entity\s*:/i.test(line) && !/^concept\s*:/i.test(line));
    return (candidates.length > 0 ? candidates : [content.trim()])
        .filter(Boolean)
        .slice(0, 5)
        .map((line) => line.length > 240 ? `${line.slice(0, 237)}...` : line);
}
function selectCaveatSignals(content) {
    const caveatPattern = /\b(however|but|except|unless|edge case|caveat|risk|conflict|contradict|deprecated|uncertain|unknown)\b/i;
    const caveats = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => caveatPattern.test(line))
        .slice(0, 5)
        .map((line) => `- ${line.length > 240 ? `${line.slice(0, 237)}...` : line}`);
    return caveats.length > 0 ? caveats : ['- 未检测到明显边界信号；在将摘要视为完整结论前仍需核对原始材料。'];
}
function buildIndexMutations(sourcePage, entityPages, conceptPages) {
    return [
        {
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[sources/${sourcePage.slug}|${sourcePage.title}]]`,
        },
        ...entityPages.map((page) => ({
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[entities/${page.slug}|${page.title}]]`,
        })),
        ...conceptPages.map((page) => ({
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[concepts/${page.slug}|${page.title}]]`,
        })),
    ];
}
function buildTaxonomyEffects(topics, sourcePage) {
    return topics.map((topic) => ({
        action: 'propose-topic',
        slug: topic.slug,
        title: topic.title,
        confidence: topic.confidence,
        rationale: topic.rationale,
        source: {
            slug: sourcePage.slug,
            title: sourcePage.title,
            artifactId: sourcePage.artifactId ?? '',
        },
    }));
}
function buildReviewEffects(analysis, entityCandidates, conceptCandidates) {
    return [
        ...analysis.reviewTriggers
            .filter((trigger) => trigger.kind !== 'low-confidence')
            .map((trigger) => ({
            ...trigger,
            artifactId: analysis.artifactId,
        })),
        ...entityCandidates
            .filter((candidate) => candidate.source === 'marker')
            .map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'entity', candidate)),
        ...conceptCandidates
            .filter((candidate) => candidate.source === 'marker')
            .map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'concept', candidate)),
    ];
}
function buildCandidateReviewEffect(artifactId, candidateType, candidate) {
    return {
        artifactId,
        kind: 'semantic-candidate',
        severity: 'low',
        reason: `显式${candidateType === 'entity' ? '实体' : '概念'}候选“${candidate.title}”（${candidate.confidence.toFixed(2)}）需要批准后才能成为稳定 wiki 语义。`,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        candidate: {
            kind: candidateType,
            slug: candidate.slug,
            title: candidate.title,
            confidence: candidate.confidence,
            source: candidate.source,
            evidence: candidate.evidence,
        },
        suggestedActions: [
            `判断“${candidate.title}”是否应成为稳定${candidateType === 'entity' ? '实体' : '概念'}页面。`,
            '在写入稳定 wiki 前，先批准、重命名/合并或拒绝该候选项。',
        ],
    };
}
function removeSourceTitleHeuristics(candidates, sourceSlug) {
    return candidates.filter((candidate) => !(candidate.source === 'heuristic' && candidate.slug === sourceSlug));
}
function buildStableArtifactSlug(analysis) {
    return stableSlug(analysis.artifact.title, analysis.artifactId);
}
function stableSlug(value, fallback) {
    const slug = slugify(value);
    return slug.length > 0 ? slug : fallback;
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
