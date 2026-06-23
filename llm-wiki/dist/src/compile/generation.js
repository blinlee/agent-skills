import { slugify } from './semantic-curation.js';
export async function generateKnowledgeChanges(artifact, curation, options = {}) {
    const sourceSlug = options.sourceSlug ?? stableSlug(artifact.title, artifact.id);
    const sourcePage = {
        slug: sourceSlug,
        title: artifact.title,
        artifactId: artifact.id,
        topics: [],
        backlinks: [],
        body: '',
    };
    const readingPage = {
        slug: sourceSlug,
        title: `${artifact.title} - 完整原文`,
        artifactId: artifact.id,
        topics: [],
        backlinks: [`sources/${sourceSlug}`],
        body: buildReadingPageBody(artifact, sourcePage),
    };
    const entityPages = curation.entities.map((entity, index) => buildEntityPage(entity, index, artifact.id, sourcePage));
    const conceptPages = curation.concepts.map((concept, index) => buildConceptPage(concept, index, artifact.id, sourcePage));
    const synthesisPages = curation.syntheses.map((synthesis, index) => buildSynthesisPage(synthesis, index, artifact.id, sourcePage));
    sourcePage.body = buildSourcePageBody(artifact, curation, {
        readingPage,
        entityPages,
        conceptPages,
        synthesisPages,
    });
    const indexMutations = buildIndexMutations(sourcePage, readingPage, entityPages, conceptPages, synthesisPages);
    const logMutations = [{
            target: 'wiki/log.md',
            op: 'append',
            value: `${artifact.updatedAt}\tcompiled\t${artifact.id}\t${sourceSlug}`,
        }];
    return {
        artifactId: artifact.id,
        sourcePage,
        readingPage,
        entityPages,
        conceptPages,
        synthesisPages,
        indexMutations,
        logMutations,
        taxonomyEffects: [],
        reviewEffects: [],
    };
}
function buildSourcePageBody(artifact, curation, generatedPages) {
    const knowledgeLinks = [
        ...generatedPages.entityPages.map((page) => `- [[entities/${page.slug}|${page.title}]]`),
        ...generatedPages.conceptPages.map((page) => `- [[concepts/${page.slug}|${page.title}]]`),
        ...generatedPages.synthesisPages.map((page) => `- [[syntheses/${page.slug}|${page.title}]]`),
    ];
    const rejectionLines = curation.rejections.length > 0
        ? curation.rejections.map((rejection) => `- ${rejection.text}: ${rejection.reason}`)
        : ['- 无。'];
    return [
        `# ${artifact.title}`,
        '',
        `- 资料 ID: ${artifact.id}`,
        `- 来源类型: ${sourceKindLabel(artifact.sourceKind)}`,
        `- 来源引用: ${artifact.sourceRef}`,
        '- 语义整理: curation-plan-backed',
        '',
        '## 原文入口',
        `- [[readings/${generatedPages.readingPage.slug}|完整原文]]`,
        `- ${formatExternalSourceLink(artifact.sourceRef, '打开原始来源')}`,
        '',
        '## 知识入口',
        ...(knowledgeLinks.length > 0 ? knowledgeLinks : ['- curation plan 未接受适合单独建页的普通实体、概念或综合页。']),
        '',
        '## 中文速读',
        curation.summary,
        '',
        '## 未入库候选',
        ...rejectionLines,
        '',
        '## 证据说明',
        '原始采集材料是事实依据。本页是语义整理后的资料卡，用于定位与浏览，不能替代原始证据。',
        '',
        '本页是资料卡；完整阅读请进入上方“完整原文”。结构性重命名、合并、跨 wiki 边界仍由 govern 处理。',
        '',
        '## 原文摘录',
        artifact.content.slice(0, 1200),
    ].join('\n');
}
function buildReadingPageBody(artifact, sourcePage) {
    return [
        `# ${artifact.title}`,
        '',
        `- 资料 ID: ${artifact.id}`,
        `- 来源类型: ${sourceKindLabel(artifact.sourceKind)}`,
        `- 来源引用: ${artifact.sourceRef}`,
        `- 来源卡片: [[sources/${sourcePage.slug}|${sourcePage.title}]]`,
        '',
        '## 说明',
        '这是入库流程生成的 Obsidian 阅读镜像，用于直接阅读完整正文和参与本地链接导航。raw/objects、raw/staged 或 raw/archive 中的受管材料仍是保真证据；不要编辑本页来修正原始证据。',
        '',
        '## 原文全文',
        '',
        artifact.content.trim(),
    ].join('\n').trimEnd();
}
function buildEntityPage(entity, index, artifactId, sourcePage) {
    const slug = pageSlug(entity.slug, entity.title, `entity-${index + 1}`);
    return {
        slug,
        title: entity.title,
        artifactId,
        topics: [],
        backlinks: [`sources/${sourcePage.slug}`],
        body: buildCuratedNodeBody({
            title: entity.title,
            label: '实体',
            description: entity.description,
            evidence: entity.evidence,
            sourcePage,
            extraLines: [`- 类型: ${entity.kind}`],
        }),
    };
}
function buildConceptPage(concept, index, artifactId, sourcePage) {
    const slug = pageSlug(concept.slug, concept.title, `concept-${index + 1}`);
    return {
        slug,
        title: concept.title,
        artifactId,
        topics: [],
        backlinks: [`sources/${sourcePage.slug}`],
        body: buildCuratedNodeBody({
            title: concept.title,
            label: '概念',
            description: concept.description,
            evidence: concept.evidence,
            sourcePage,
            extraLines: [],
        }),
    };
}
function buildSynthesisPage(synthesis, index, artifactId, sourcePage) {
    const slug = pageSlug(synthesis.slug, synthesis.title, `synthesis-${index + 1}`);
    return {
        slug,
        title: synthesis.title,
        artifactId,
        topics: [],
        backlinks: [`sources/${sourcePage.slug}`],
        body: buildCuratedNodeBody({
            title: synthesis.title,
            label: '综合',
            description: synthesis.description,
            evidence: synthesis.evidence,
            sourcePage,
            extraLines: [],
        }),
    };
}
function buildCuratedNodeBody(input) {
    return [
        `# ${input.title}`,
        '',
        '## 说明',
        `这是入库时根据 curation plan 从原文证据中创建的${input.label}页。它不是代码规则抽词结果；每条内容必须能回到原文证据。`,
        '',
        '## 中文解释',
        input.description,
        '',
        '## 来源',
        `- [[sources/${input.sourcePage.slug}|${input.sourcePage.title}]]`,
        '',
        '## 属性',
        ...input.extraLines,
        ...(input.extraLines.length === 0 ? ['- 来源: semantic curation plan'] : []),
        '',
        '## 原文证据',
        ...input.evidence.flatMap((evidence) => [
            `- ${evidence.quote}`,
            ...(evidence.note ? [`  - 说明: ${evidence.note}`] : []),
        ]),
    ].join('\n');
}
function buildIndexMutations(sourcePage, readingPage, entityPages, conceptPages, synthesisPages) {
    return [
        {
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[sources/${sourcePage.slug}|${sourcePage.title}]]`,
        },
        {
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[readings/${readingPage.slug}|${readingPage.title}]]`,
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
        ...synthesisPages.map((page) => ({
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[syntheses/${page.slug}|${page.title}]]`,
        })),
    ];
}
function formatExternalSourceLink(sourceRef, label) {
    return `[${label}](<${sourceRef}>)`;
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
function pageSlug(explicitSlug, title, fallback) {
    return explicitSlug ?? stableSlug(title, fallback);
}
function stableSlug(value, fallback) {
    const slug = slugify(value);
    return slug.length > 0 ? slug : fallback;
}
