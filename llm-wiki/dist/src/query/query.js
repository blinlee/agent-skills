import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { appendWikiLog } from '../wiki/index-log.js';
import { writeJsonFile } from '../shared/fs.js';
import { buildLayeredContextPack } from '../retrieval/context-builder.js';
import { buildGroundingDiagnostics } from './grounding.js';
import { buildSourceReadingPack } from './source-reading-pack.js';
import { retrieveChunks } from '../retrieval/retrieval.js';
import { buildKnowledgeQueryReadiness } from '../retrieval/readiness.js';
import { tokenize } from '../retrieval/tokenize.js';
import { comparePageOrder, loadIndexedPages, parseWikiLinks, resolveWikiLink } from '../wiki/links.js';
const OVERVIEW_PATTERNS = [
    /summari[sz]e\s+what\s+has\s+been\s+(?:ingested|indexed|imported)/i,
    /what\s+has\s+been\s+(?:ingested|indexed|imported)/i,
    /what\s+was\s+(?:ingested|indexed|imported)/i,
    /\boverview\b/i,
    /what\s+is\s+in\s+the\s+wiki/i,
];
export { loadIndexedPages, parseIndexedTarget, parseWikiLinks, resolveWikiLink } from '../wiki/links.js';
export async function runQuery(input) {
    const root = path.resolve(input.knowledgeRoot);
    const indexedPages = await loadIndexedPages(root);
    if (indexedPages.length === 0) {
        throw new Error(`Cannot query ${root}: wiki/index.md has no indexed pages.`);
    }
    const readiness = await buildKnowledgeQueryReadiness({ knowledgeRoot: root });
    const retrieval = input.retrieval ?? await retrieveChunks({
        knowledgeRoot: root,
        question: input.question,
        includeReview: input.includeReview,
        disableHyde: input.disableHyde,
    });
    const selection = retrieval.mode === 'fallback'
        ? await selectRelevantPages(root, input.question, indexedPages)
        : selectionFromRetrieval(retrieval);
    const citations = retrieval.mode === 'fallback'
        ? selection.pages.map(({ page, content }) => ({
            target: page.target,
            title: page.title,
            filePath: page.filePath,
            excerpt: buildExcerpt(content),
        }))
        : retrieval.hits.map((hit) => ({
            target: hit.citation.pageTarget,
            title: hit.citation.pageTitle,
            filePath: hit.citation.filePath,
            excerpt: hit.citation.excerpt,
            chunkId: hit.citation.chunkId,
            pageTarget: hit.citation.pageTarget,
            heading: hit.citation.heading,
            headingPath: hit.citation.headingPath,
            startLine: hit.citation.startLine,
            endLine: hit.citation.endLine,
            sourceRef: hit.citation.sourceRef,
            rawPath: hit.citation.rawPath ?? null,
            artifactId: hit.citation.artifactId ?? null,
            evidenceKind: hit.citation.evidenceKind ?? (hit.citation.rawPath ? 'raw' : 'wiki'),
            retrievalScore: hit.score,
            retrievalReasons: hit.reasons,
        }));
    const contextLayers = await buildLayeredContextPack({
        knowledgeRoot: root,
        citations,
    });
    const redactor = createSensitiveRedactor(input.question);
    const displayQuestion = redactor(input.question);
    const groundedCitations = redactCitations(compressCitations(citations, retrieval.signalSummary.evidenceBudget), redactor);
    const lowConfidenceRefusal = retrieval.signalSummary.confidence.lowConfidence;
    const grounding = buildGroundingDiagnostics(displayQuestion, selection, groundedCitations, retrieval.signalSummary.evidenceBudget, lowConfidenceRefusal, undefined, input.queryIntent);
    const answer = redactor(buildGroundedAnswer(displayQuestion, selection, groundedCitations, grounding));
    const suggestion = selection.mode === 'matched' && selection.pages[0] && grounding.answerability === 'answered'
        ? await persistSynthesisSuggestion({
            knowledgeRoot: root,
            question: displayQuestion,
            answer,
            citations: groundedCitations,
            grounding,
            primaryPage: selection.pages[0].page,
        })
        : null;
    await appendWikiLog(root, `query\t${JSON.stringify({
        question: displayQuestion,
        selectionMode: selection.mode,
        suggestionId: suggestion?.id ?? null,
        citationCount: groundedCitations.length,
        answerability: grounding.answerability,
        conflictCount: grounding.conflictCount,
        retrievalSignals: retrieval.signalSummary.signalCounts,
        retrievalSources: retrieval.signalSummary.sourceCounts,
    })}`);
    const retrievalDiagnostics = {
        mode: retrieval.mode,
        messages: retrieval.diagnostics,
        signalSummary: retrieval.signalSummary,
    };
    return {
        question: displayQuestion,
        answer,
        citations: groundedCitations,
        readiness,
        retrieval: retrievalDiagnostics,
        grounding,
        sourceReadingPack: await buildSourceReadingPack(root, grounding.answerability, groundedCitations, redactor),
        agentReadingPack: buildAgentReadingPack(retrievalDiagnostics, grounding, groundedCitations, contextLayers),
        synthesisSuggestion: suggestion,
    };
}
function buildAgentReadingPack(retrieval, grounding, citations, contextLayers) {
    return {
        answerability: grounding.answerability,
        retrievalMode: retrieval.mode,
        embeddingUsed: retrieval.signalSummary.signalCounts.embedding > 0,
        citationCount: citations.length,
        mustReadFurther: grounding.answerability === 'answered' && citations.length > 0,
        citationsToRead: citations.map((citation, index) => ({
            citationIndex: index + 1,
            target: citation.target,
            title: citation.title,
            filePath: citation.filePath,
            heading: citation.heading,
            startLine: citation.startLine,
            endLine: citation.endLine,
            sourceRef: citation.sourceRef,
            rawPath: citation.rawPath,
            artifactId: citation.artifactId,
            evidenceKind: citation.evidenceKind,
            chunkId: citation.chunkId,
        })),
        contextLayers,
        diagnostics: retrieval.messages,
    };
}
function selectionFromRetrieval(retrieval) {
    if (retrieval.hits.length === 0) {
        return { mode: 'no-match', pages: [] };
    }
    return {
        mode: retrieval.mode === 'overview' ? 'overview' : 'matched',
        pages: retrieval.hits.map((hit) => ({
            page: {
                section: hit.chunk.metadata.section,
                slug: hit.chunk.metadata.slug,
                title: hit.chunk.pageTitle,
                target: hit.chunk.pageTarget,
                filePath: hit.chunk.filePath,
            },
            content: hit.chunk.text,
            heading: hit.chunk.heading,
            startLine: hit.chunk.startLine,
            endLine: hit.chunk.endLine,
        })),
    };
}
async function selectRelevantPages(knowledgeRoot, question, indexedPages) {
    const rankedPages = (await Promise.all(indexedPages.map(async (page) => {
        const content = await readWikiPageContentIfPresent(knowledgeRoot, page);
        return content === null
            ? null
            : {
                page,
                content,
                score: scorePage(question, page, content),
            };
    })))
        .filter((entry) => entry !== null)
        .sort((left, right) => right.score - left.score || comparePageOrder(left.page, right.page));
    if (rankedPages.length === 0) {
        return {
            mode: 'no-match',
            pages: [],
        };
    }
    const seedPages = rankedPages.filter((entry) => entry.score > 0).slice(0, 2);
    if (seedPages.length === 0) {
        if (!isOverviewQuestion(question)) {
            return {
                mode: 'no-match',
                pages: [],
            };
        }
        const overviewPages = rankedPages
            .filter((entry) => entry.page.section === 'sources')
            .slice(0, 2);
        const fallbackOverviewPages = overviewPages.length > 0 ? overviewPages : rankedPages.slice(0, 2);
        const selected = new Map();
        for (const entry of fallbackOverviewPages) {
            addPageSelection(selected, entry.page, entry.content);
        }
        return {
            mode: 'overview',
            pages: [...selected.values()],
        };
    }
    const selected = new Map();
    const indexedContent = new Map(rankedPages.map((entry) => [entry.page.target, entry.content]));
    for (const entry of seedPages) {
        addPageSelection(selected, entry.page, entry.content);
    }
    for (const { page, content } of [...selected.values()]) {
        for (const link of parseWikiLinks(content)) {
            const resolved = resolveWikiLink(link.rawTarget, indexedPages);
            if (resolved.status !== 'resolved') {
                continue;
            }
            const linkedContent = indexedContent.get(resolved.page.target);
            if (linkedContent === undefined) {
                continue;
            }
            addPageSelection(selected, resolved.page, linkedContent);
            if (selected.size >= 4) {
                break;
            }
        }
        if (selected.size >= 4) {
            break;
        }
    }
    return {
        mode: 'matched',
        pages: [...selected.values()],
    };
    function addPageSelection(target, page, content) {
        if (target.has(page.target)) {
            return;
        }
        target.set(page.target, { page, content });
    }
}
async function readWikiPageContent(knowledgeRoot, page) {
    return readFile(path.join(knowledgeRoot, 'wiki', page.section, `${page.slug}.md`), 'utf8');
}
async function readWikiPageContentIfPresent(knowledgeRoot, page) {
    try {
        return await readWikiPageContent(knowledgeRoot, page);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function scorePage(question, page, content) {
    const questionTokens = tokenize(question);
    const titleTokens = new Set(tokenize(`${page.title} ${page.slug.replace(/-/g, ' ')}`));
    const contentTokens = new Set(tokenize(toSearchablePageContent(content)));
    let score = 0;
    for (const token of questionTokens) {
        if (titleTokens.has(token)) {
            score += 2;
        }
        else if (contentTokens.has(token)) {
            score += 1;
        }
    }
    if (score > 0 && page.section === 'sources') {
        score += 1;
    }
    return score;
}
function toSearchablePageContent(markdown) {
    return markdown
        .replace(/^---\n[\s\S]*?\n---\n?/m, '')
        .split('\n')
        .filter((line) => !isQueryMetadataLine(line))
        .join('\n');
}
function isQueryMetadataLine(line) {
    const trimmed = line.trim();
    return [
        '- Artifact ID:',
        '- Source kind:',
        '- Source ref:',
        '- Analysis confidence:',
        '- 资料 ID:',
        '- 来源类型:',
        '- 来源引用:',
        '- 分析置信度:',
    ].some((prefix) => trimmed.startsWith(prefix));
}
function isOverviewQuestion(question) {
    return OVERVIEW_PATTERNS.some((pattern) => pattern.test(question.trim()));
}
function buildAnswer(question, selection) {
    if (selection.mode === 'no-match') {
        return `我没有在当前索引的 wiki 中找到足够证据来回答“${question}”。可以换用已知页面标题重问，或先摄入更多来源材料。`;
    }
    if (selection.mode === 'overview') {
        const sourceSummaries = selection.pages
            .map(({ page, content }) => `${page.title}: ${extractSummary(content)}`)
            .join(' ');
        return compact(`根据已索引来源，当前 wiki 主要覆盖：${sourceSummaries}`);
    }
    const primary = selection.pages[0];
    const related = selection.pages.slice(1);
    const summary = primary ? extractSummary(primary.content) : '没有索引页面匹配这个问题。';
    const evidenceScope = primary?.heading
        ? `（${primary.heading}，第 ${primary.startLine}-${primary.endLine} 行）`
        : '';
    const relatedLead = related.length > 0
        ? ` 相关证据：${related.map(({ page, heading }) => heading ? `${page.title}/${heading}` : page.title).join('、')}。`
        : '';
    return `${primary?.page.title ?? '这个 wiki'}${evidenceScope} 对“${question}”的回答是：${summary}。${relatedLead}`.replace(/。。/g, '。');
}
function compressCitations(citations, budget) {
    const seen = new Set();
    const selected = [];
    let usedChars = 0;
    for (const citation of citations) {
        if (selected.length >= budget.citationLimit || usedChars >= budget.contextCharCap)
            break;
        const key = citation.sourceRef
            ? `source:${citation.sourceRef}:${citation.startLine}:${citation.endLine}`
            : `target:${citation.target}:${citation.chunkId ?? citation.excerpt}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const remainingChars = budget.contextCharCap - usedChars;
        const excerpt = compressCitationExcerpt(citation.excerpt, remainingChars);
        if (!excerpt)
            continue;
        usedChars += excerpt.length;
        selected.push({
            ...citation,
            excerpt,
        });
    }
    return selected;
}
function compressCitationExcerpt(excerpt, maxChars) {
    if (maxChars <= 0) {
        return '';
    }
    return compact(excerpt).slice(0, Math.min(360, maxChars));
}
function redactCitations(citations, redactor) {
    return citations.map((citation) => ({
        ...citation,
        title: redactor(citation.title),
        excerpt: redactor(citation.excerpt),
        heading: citation.heading ? redactor(citation.heading) : citation.heading,
        headingPath: citation.headingPath?.map((heading) => redactor(heading)),
    }));
}
export function createSensitiveRedactor(seedText) {
    const explicitSecrets = new Set();
    const secretPatterns = [
        /\b(?:sk|pk|ghp|github_pat|xox[baprs]?|ya29|AIza)[A-Za-z0-9_\-]{8,}\b/g,
        /\b[A-Z][A-Z0-9_]{11,}\b/g,
        /\b[A-Za-z0-9_\-]{24,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{12,}\b/g,
    ];
    for (const pattern of secretPatterns) {
        for (const match of seedText.matchAll(pattern)) {
            if (match[0])
                explicitSecrets.add(match[0]);
        }
    }
    return (text) => {
        let redacted = text;
        for (const secret of explicitSecrets) {
            redacted = redacted.split(secret).join('[REDACTED]');
        }
        for (const pattern of secretPatterns) {
            redacted = redacted.replace(pattern, '[REDACTED]');
        }
        return redacted;
    };
}
function buildGroundedAnswer(question, selection, citations, grounding) {
    if (grounding.answerability === 'insufficient-evidence') {
        return `我没有在当前索引的 wiki 中找到足够证据来回答“${question}”。可以换用已知页面标题重问，或先摄入更多来源材料。`;
    }
    const base = buildAnswer(question, selection);
    const claimLines = grounding.claims.length > 0
        ? ` 关键证据：${grounding.claims.map((claim) => `${claim.text} [${claim.citationIndexes.join(',')}; conf=${claim.confidence}]`).join('；')}。`
        : '';
    const evidenceLines = citations
        .map((citation, index) => {
        const span = citation.startLine && citation.endLine ? `第 ${citation.startLine}-${citation.endLine} 行` : '页面级证据';
        const heading = citation.heading ? ` / ${citation.heading}` : '';
        return `[${index + 1}] ${citation.title}${heading}（${span}）`;
    })
        .join('；');
    const conflictNote = grounding.conflictCount > 0
        ? ` 检索证据中有 ${grounding.conflictCount} 条疑似冲突/过时信号，结论需人工复核：${grounding.contradictionTable.map((entry) => `${entry.issueId} ${entry.recommendation}`).join('；') || '请比较来源时间、适用范围和原始材料'}。`
        : '';
    return `${base}${claimLines} 证据范围：${evidenceLines}。${conflictNote}`.replace(/。。/g, '。');
}
function extractSummary(markdown) {
    const normalized = markdown.replace(/\r\n?/g, '\n');
    const summaryMatch = normalized.match(/^## (?:摘要|Summary)\n([\s\S]*?)(?:\n## |$)/m);
    if (summaryMatch?.[1]) {
        return compact(summaryMatch[1]);
    }
    const lines = normalized
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.startsWith('#'))
        .filter((line) => !line.startsWith('- Artifact ID:'))
        .filter((line) => !line.startsWith('- Source kind:'))
        .filter((line) => !line.startsWith('- Source ref:'))
        .filter((line) => !line.startsWith('- Analysis confidence:'))
        .filter((line) => !line.startsWith('- 资料 ID:'))
        .filter((line) => !line.startsWith('- 来源类型:'))
        .filter((line) => !line.startsWith('- 来源引用:'))
        .filter((line) => !line.startsWith('- 分析置信度:'));
    return compact(lines.slice(0, 3).join(' '));
}
function buildExcerpt(markdown) {
    return compact(markdown.replace(/^# .*$/m, '')).slice(0, 240);
}
function compact(value) {
    return value.replace(/\s+/g, ' ').trim();
}
async function persistSynthesisSuggestion(input) {
    const id = `synthesis-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const title = `${input.primaryPage.title} synthesis suggestion`;
    const slug = buildSuggestionSlug(input.primaryPage.slug, id);
    const filePath = path.join(input.knowledgeRoot, 'review', 'queue', `${id}.json`);
    const mergeCandidatePath = path.join(input.knowledgeRoot, 'review', 'merge-candidates', `${id}.json`);
    const markdown = buildSuggestionMarkdown({
        title,
        question: input.question,
        answer: input.answer,
        citations: input.citations,
        grounding: input.grounding,
        suggestionId: id,
        createdAt,
    });
    const record = {
        id,
        type: 'synthesis-suggestion',
        status: 'suggested',
        question: input.question,
        title,
        slug,
        answer: input.answer,
        citations: input.citations,
        relatedPages: input.citations.map((citation) => citation.target),
        grounding: input.grounding,
        markdown,
        createdAt,
        updatedAt: createdAt,
    };
    await Promise.all([
        writeJsonFile(filePath, record),
        writeJsonFile(mergeCandidatePath, record),
    ]);
    return {
        id,
        status: record.status,
        slug,
        title,
        filePath,
    };
}
function buildSuggestionSlug(primarySlug, suggestionId) {
    const uniqueSuffix = suggestionId.replace(/^synthesis-/, '');
    return `${primarySlug}-query-synthesis-${uniqueSuffix}`;
}
function formatGroundedClaims(grounding) {
    return grounding.claims.length > 0
        ? grounding.claims.map((claim) => `- ${claim.text} [${claim.supportingCitations.join(', ')}] confidence=${claim.confidence} support=${claim.supportLevel} coverage=${claim.citationCoverage} matched=${claim.matchedTerms.join(', ') || 'none'} reason=${claim.reason}`)
        : ['- No claim-level citations captured.'];
}
function formatConflictSignals(grounding) {
    return grounding.conflicts.length > 0
        ? [
            '| Kind | Severity | Reason | Evidence pair | Targets | Chunk IDs |',
            '|---|---|---|---|---|---|',
            ...grounding.conflicts.map((signal) => `| ${signal.kind} | ${signal.severity} | ${signal.reason} | ${signal.evidence.map((entry) => `${entry.citationIndex}:${entry.matchedText ?? 'excerpt'}`).join('<br>')} | ${signal.targets.join('<br>')} | ${signal.chunkIds.join('<br>')} |`),
        ]
        : ['- No conflict signals detected.'];
}
function formatContradictionTable(grounding) {
    return grounding.contradictionTable.length > 0
        ? [
            '| Issue | Severity | Summary | Recommendation | Evidence |',
            '|---|---|---|---|---|',
            ...grounding.contradictionTable.map((entry) => `| ${entry.issueId} | ${entry.severity} | ${entry.summary} | ${entry.recommendation} | ${entry.evidence.map((item) => `#${item.citationIndex} ${item.target}`).join('<br>')} |`),
        ]
        : ['- No structured contradiction table entries.'];
}
function buildSuggestionMarkdown(input) {
    const citationLines = input.citations.length > 0
        ? input.citations.map((citation) => {
            const span = citation.startLine && citation.endLine ? `:${citation.startLine}-${citation.endLine}` : '';
            const heading = citation.heading ? ` / ${citation.heading}` : '';
            return `- [[${citation.target}|${citation.title}]]${heading}${span} — ${citation.excerpt}`;
        })
        : ['- 未捕获到支撑引用。'];
    return [
        `# ${input.title}`,
        '',
        `- 建议 ID: ${input.suggestionId}`,
        `- 创建时间: ${input.createdAt}`,
        '',
        '## 问题',
        input.question,
        '',
        '## 综合回答',
        input.answer,
        '',
        '## 证据约束',
        `- Answerability: ${input.grounding.answerability}`,
        `- Evidence budget: ${input.grounding.evidenceBudget}`,
        `- Selected citations: ${input.grounding.selectedCitationCount}`,
        `- Potential conflicts: ${input.grounding.conflictCount}`,
        '',
        '## Claim-level citations',
        ...formatGroundedClaims(input.grounding),
        '',
        '## Conflict signals',
        ...formatConflictSignals(input.grounding),
        '',
        '## Structured contradiction table',
        ...formatContradictionTable(input.grounding),
        '',
        '## 引用',
        ...citationLines,
    ].join('\n').trimEnd() + '\n';
}
