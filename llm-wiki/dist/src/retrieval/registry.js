import { createSensitiveRedactor, runQuery } from '../query/query.js';
import { buildQueryIntent, isEmbeddingOnlyScore, isEvidenceDomainConsistent, isFocusedEvidenceForIntent, isMeaningfulNonEmbeddingSupport, isStrongSemanticEvidence, scoreEvidenceIntentFit } from '../query/intent.js';
import { buildKnowledgeQueryReadiness } from './readiness.js';
import { buildRegistryDiagnostics } from './registry-diagnostics.js';
import { buildRegistryAgentReadingPack, buildRegistryAnswer } from './registry-output.js';
import { nonGenericProfileTerms, queryIntentProfilesForWikis } from './registry-profiles.js';
import { buildRegistrySourceReadingPack, registryCitationKey, registryPassagesByCitation } from './registry-source-pack.js';
import { loadRerankConfigFromEnv, LocalHttpReranker } from './rerank.js';
import { retrieveChunks } from './retrieval.js';
export async function runRegistryHybridRetrieval(input) {
    const citationBudget = Math.max(1, input.citationBudget ?? 8);
    const maxCitationsPerWiki = Math.max(1, input.maxCitationsPerWiki ?? 3);
    const maxConcurrentWikis = Math.max(1, input.maxConcurrentWikis ?? 4);
    const redactor = createSensitiveRedactor(input.question);
    const displayQuestion = redactor(input.question);
    const queryIntent = input.queryIntent ?? buildQueryIntent(input.question, queryIntentProfilesForWikis(input.selectedWikis), { readingMode: input.readingMode });
    const readingMode = input.readingMode ?? (queryIntent.prefersDocumentReading ? 'document' : 'passage');
    const results = await mapWithConcurrency(input.selectedWikis, maxConcurrentWikis, async (wiki) => queryRegistryWiki(input.question, wiki, redactor, { limit: retrievalLimitForIntent(queryIntent), queryIntent }));
    results.sort(compareRegistryResults);
    const allCitations = results.flatMap((entry) => entry.citationPack);
    const passagesByCitation = registryPassagesByCitation(results);
    const registryRerankDiagnostics = [];
    const rankedCitations = await rerankRegistryCitations({
        question: input.question,
        citations: allCitations,
        queryIntent,
        passagesByCitation,
        citationBudget,
        diagnostics: registryRerankDiagnostics,
        config: input.rerankConfig,
        reranker: input.reranker,
    });
    const answerableWikiIds = new Set(results
        .filter((entry) => entry.result?.grounding.answerability === 'answered')
        .map((entry) => entry.wikiId));
    const citations = readingMode === 'document'
        ? selectSurveyRegistryCitations(rankedCitations, queryIntent, results, { citationBudget, maxCitationsPerWiki })
        : selectDefaultRegistryCitations(rankedCitations, queryIntent, results, { citationBudget, maxCitationsPerWiki });
    const answerability = citations.some((citation) => isRegistryAnswerEvidence(citation, answerableWikiIds)) ? 'answered' : 'insufficient-evidence';
    const outputResults = orderRegistryResultsForOutput(results, citations);
    const diagnostics = buildRegistryDiagnostics({
        selectedWikiCount: input.selectedWikis.length,
        results: outputResults,
        citationCountBeforeDedupe: allCitations.length,
        citationCountAfterDedupe: citations.length,
        selectedCitations: citations,
        citationBudget,
        maxCitationsPerWiki,
        maxConcurrentWikis,
        registryRerankDiagnostics,
    });
    const selectedWikis = outputResults.map(({ wikiId, title, knowledgeRoot, score, matchedTerms, chunkScore, calibratedScore }) => ({
        wikiId,
        title,
        knowledgeRoot,
        score,
        matchedTerms,
        chunkScore,
        calibratedScore,
    }));
    return {
        answer: redactor(buildRegistryAnswer(displayQuestion, outputResults, citations, answerability)),
        selectedWikis,
        citations,
        diagnostics,
        sourceReadingPack: buildRegistrySourceReadingPack(answerability, citations, outputResults, passagesByCitation, readingMode),
        agentReadingPack: buildRegistryAgentReadingPack({ results: outputResults, selectedWikis, citations, diagnostics, answerability }),
        results: outputResults,
    };
}
async function queryRegistryWiki(question, wiki, redactor, options = {}) {
    const started = Date.now();
    try {
        const readiness = await buildKnowledgeQueryReadiness({ knowledgeRoot: wiki.knowledgeRoot });
        const retrieval = await retrieveChunks({ knowledgeRoot: wiki.knowledgeRoot, question, limit: options.limit });
        const result = await runQuery({ knowledgeRoot: wiki.knowledgeRoot, question, retrieval, queryIntent: options.queryIntent });
        const citationPack = buildRegistryCitationPack(wiki, retrieval.hits, redactor);
        const chunkScore = citationPack[0]?.score.total ?? 0;
        return {
            ...wiki,
            chunkScore,
            calibratedScore: calibratedRegistryScore(chunkScore, wiki.score),
            durationMs: Date.now() - started,
            citationPack,
            retrievalSignals: retrieval.signalSummary,
            retrievalDiagnostics: retrieval.diagnostics,
            readiness,
            result,
            error: null,
        };
    }
    catch (error) {
        return {
            ...wiki,
            chunkScore: 0,
            calibratedScore: calibratedRegistryScore(0, wiki.score),
            durationMs: Date.now() - started,
            citationPack: [],
            retrievalSignals: null,
            retrievalDiagnostics: [],
            readiness: null,
            result: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
function calibratedRegistryScore(chunkScore, profileScore) {
    const boundedProfileScore = Math.max(0, Math.min(1, profileScore));
    return Number((chunkScore + boundedProfileScore * 0.05).toFixed(6));
}
async function mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
function buildRegistryCitationPack(wiki, hits, redactor) {
    return hits.map((hit) => ({
        target: hit.citation.pageTarget,
        title: redactor(hit.citation.pageTitle),
        filePath: hit.citation.filePath,
        excerpt: redactor(hit.citation.excerpt),
        chunkId: hit.citation.chunkId,
        pageTarget: hit.citation.pageTarget,
        heading: hit.citation.heading ? redactor(hit.citation.heading) : hit.citation.heading,
        headingPath: hit.citation.headingPath?.map((heading) => redactor(heading)),
        startLine: hit.citation.startLine,
        endLine: hit.citation.endLine,
        sourceRef: hit.citation.sourceRef,
        rawPath: hit.citation.rawPath ?? null,
        artifactId: hit.citation.artifactId ?? null,
        evidenceKind: hit.citation.evidenceKind ?? (hit.citation.rawPath ? 'raw' : 'wiki'),
        wikiId: wiki.wikiId,
        wikiTitle: wiki.title,
        knowledgeRoot: wiki.knowledgeRoot,
        score: hit.score,
        reasons: hit.reasons,
    }));
}
function compareRegistryResults(left, right) {
    return right.calibratedScore - left.calibratedScore
        || right.chunkScore - left.chunkScore
        || right.score - left.score
        || topRegistryEmbeddingScore(right) - topRegistryEmbeddingScore(left)
        || left.wikiId.localeCompare(right.wikiId);
}
function topRegistryEmbeddingScore(result) {
    return Math.max(0, ...result.citationPack.map((citation) => citation.score.embedding));
}
function orderRegistryResultsForOutput(results, citations) {
    const firstCitationRank = new Map();
    citations.forEach((citation, index) => {
        if (!firstCitationRank.has(citation.wikiId)) {
            firstCitationRank.set(citation.wikiId, index);
        }
    });
    return [...results].sort((left, right) => {
        const leftRank = firstCitationRank.get(left.wikiId) ?? Number.POSITIVE_INFINITY;
        const rightRank = firstCitationRank.get(right.wikiId) ?? Number.POSITIVE_INFINITY;
        return leftRank - rightRank || compareRegistryResults(left, right);
    });
}
function diversifyRegistryCitations(citations, queryIntent, options = {}) {
    const citationBudget = options.citationBudget ?? 8;
    const maxCitationsPerWiki = options.maxCitationsPerWiki ?? 3;
    const seen = new Set();
    const wikiCounts = new Map();
    const diversified = [];
    const sorted = [...citations].sort((left, right) => compareRegistryCitations(left, right, queryIntent));
    for (const citation of sorted) {
        if (diversified.length >= citationBudget)
            break;
        const wikiCount = wikiCounts.get(citation.wikiId) ?? 0;
        if (wikiCount >= maxCitationsPerWiki)
            continue;
        const key = citation.sourceRef
            ? `source:${citation.sourceRef}:${citation.startLine}:${citation.endLine}`
            : `page:${citation.pageTarget}:${citation.chunkId}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        wikiCounts.set(citation.wikiId, wikiCount + 1);
        diversified.push(citation);
    }
    return diversified;
}
function selectDefaultRegistryCitations(citations, queryIntent, results, options) {
    const pool = citations;
    const topScore = Math.max(0, ...pool.map((citation) => citation.score.total));
    const minScore = Math.max(0.18, topScore * 0.55);
    const strong = pool.filter((citation) => isDefaultRegistryEvidence(citation, minScore, queryIntent));
    const coherent = restrictGenericRegistryCitationsToLeadingWikis(strong, queryIntent, results);
    if (coherent.length > 0) {
        return diversifyRegistryCitations(coherent, queryIntent, options);
    }
    return [];
}
function selectSurveyRegistryCitations(citations, queryIntent, results, options) {
    const topScore = Math.max(0, ...citations.map((citation) => citation.score.total));
    const minScore = Math.max(0.1, topScore * 0.25);
    const candidates = restrictGenericRegistryCitationsToLeadingWikis(citations.filter((citation) => isSurveyRegistryEvidence(citation, minScore, queryIntent)), queryIntent, results);
    const documents = new Map();
    for (const citation of candidates) {
        const key = registrySourceDocumentKey(citation);
        documents.set(key, [...(documents.get(key) ?? []), citation]);
    }
    const rankedDocuments = [...documents.values()]
        .map((group) => {
        const sorted = [...group].sort((left, right) => compareRegistryCitations(left, right, queryIntent));
        return {
            citation: sorted[0],
            score: surveyDocumentScore(sorted[0], queryIntent),
        };
    })
        .sort((left, right) => right.score - left.score
        || compareRegistryCitations(left.citation, right.citation, queryIntent));
    const citationBudget = options.citationBudget;
    const maxDocumentsPerWiki = Math.max(options.maxCitationsPerWiki, Math.min(6, citationBudget));
    const wikiCounts = new Map();
    const selected = [];
    for (const document of rankedDocuments) {
        if (selected.length >= citationBudget)
            break;
        const wikiCount = wikiCounts.get(document.citation.wikiId) ?? 0;
        if (wikiCount >= maxDocumentsPerWiki)
            continue;
        wikiCounts.set(document.citation.wikiId, wikiCount + 1);
        selected.push(document.citation);
    }
    if (selected.length > 0) {
        return selected;
    }
    return selectDefaultRegistryCitations(citations, queryIntent, [], options);
}
function restrictGenericRegistryCitationsToLeadingWikis(citations, queryIntent, results) {
    if (queryIntent.hasDomainSpecificIntent || queryIntent.explicitCrossDomainIntent || citations.length === 0 || results.length === 0) {
        return citations;
    }
    const citationWikiIds = new Set(citations.map((citation) => citation.wikiId));
    const rankedWikis = results
        .filter((entry) => citationWikiIds.has(entry.wikiId))
        .sort(compareRegistryResults);
    const leader = rankedWikis[0];
    if (!leader) {
        return citations;
    }
    const leaderScore = Math.max(leader.calibratedScore, leader.chunkScore, 0);
    const keepWikiIds = new Set([leader.wikiId]);
    for (const entry of rankedWikis.slice(1)) {
        const closeToLeader = leaderScore > 0 && entry.calibratedScore >= leaderScore * 0.995;
        const hasRegistrySupport = entry.score >= 2 || nonGenericProfileTerms(entry.matchedTerms).length >= 2;
        if (closeToLeader && hasRegistrySupport) {
            keepWikiIds.add(entry.wikiId);
        }
    }
    return citations.filter((citation) => keepWikiIds.has(citation.wikiId));
}
function retrievalLimitForIntent(queryIntent) {
    return queryIntent.prefersDocumentReading ? 24 : undefined;
}
function isSurveyRegistryEvidence(citation, minScore, queryIntent) {
    if (!citation.rawPath || citation.evidenceKind === 'wiki') {
        return false;
    }
    if (!isReadableRegistryCitation(citation)) {
        return false;
    }
    const evidence = citationEvidenceForIntent(citation);
    const fit = scoreEvidenceIntentFit(queryIntent, evidence);
    if (!isEvidenceDomainConsistent(queryIntent, evidence, { minScore: 0.58, minMargin: 0.25 })) {
        return false;
    }
    if (!isFocusedEvidenceForIntent(queryIntent, evidence)) {
        return false;
    }
    if (citation.score.total >= minScore) {
        return true;
    }
    if (fit.strong && fit.margin >= 0.25 && citation.score.embedding >= 0.35) {
        return true;
    }
    return isMeaningfulNonEmbeddingSupport(citation.score);
}
function surveyDocumentScore(citation, queryIntent) {
    const fit = scoreEvidenceIntentFit(queryIntent, citationEvidenceForIntent(citation)).score;
    const nonEmbedding = isMeaningfulNonEmbeddingSupport(citation.score) ? 0.08 : 0;
    return round(citation.score.total
        + citation.score.rerank * 0.35
        + fit * 0.18
        + citation.score.embedding * 0.08
        + nonEmbedding);
}
function registrySourceDocumentKey(citation) {
    return [
        citation.wikiId,
        citation.rawPath ?? citation.sourceRef ?? citation.filePath ?? citation.pageTarget,
    ].join('|');
}
const REGISTRY_RERANK_WEIGHT = 0.5;
async function rerankRegistryCitations(input) {
    const config = input.config === undefined ? loadRerankConfigFromEnv() : input.config;
    if (!config || input.citations.length === 0) {
        return input.citations;
    }
    const base = [...input.citations].sort((left, right) => compareRegistryCitations(left, right, input.queryIntent));
    const candidateCount = Math.min(Math.max(input.citationBudget * 6, input.citationBudget, 1), config.topN, base.length);
    const candidates = base.slice(0, candidateCount);
    const passthrough = base.slice(candidateCount);
    const reranker = input.reranker ?? new LocalHttpReranker();
    try {
        const scores = await reranker.rerank({
            question: input.question,
            candidates: candidates.map((citation) => ({
                chunkId: registryCitationKey(citation),
                text: registryRerankText(citation, input.passagesByCitation),
            })),
            config,
        });
        if (scores.size === 0) {
            input.diagnostics.push('registry rerank endpoint returned no usable scores; using fused order');
            return input.citations;
        }
        const reranked = candidates
            .map((citation, index) => withRegistryRerankScore(citation, scores.get(registryCitationKey(citation)), index))
            .sort((left, right) => right.score.rerank - left.score.rerank
            || compareRegistryCitations(left, right, input.queryIntent));
        input.diagnostics.push(`registry rerank applied to top ${candidateCount} candidate(s)`);
        return [...reranked, ...passthrough];
    }
    catch (error) {
        input.diagnostics.push(`registry rerank unavailable; using fused order: ${error.message}`);
        return input.citations;
    }
}
function withRegistryRerankScore(citation, score, index) {
    if (score === undefined || !Number.isFinite(score)) {
        return {
            ...citation,
            reasons: [...citation.reasons, `registry-rerank:missing:${index}`],
        };
    }
    const rerank = round(normalizeRerankScore(score));
    return {
        ...citation,
        score: {
            ...citation.score,
            rerank,
            total: round(citation.score.total + (rerank * REGISTRY_RERANK_WEIGHT)),
        },
        reasons: [...citation.reasons, `registry-rerank:score:${rerank.toFixed(3)}`],
    };
}
function registryRerankText(citation, passagesByCitation) {
    return passagesByCitation.get(registryCitationKey(citation))?.text ?? citation.excerpt;
}
function normalizeRerankScore(value) {
    if (value >= 0 && value <= 1) {
        return value;
    }
    return 1 / (1 + Math.exp(-value));
}
function isDefaultRegistryEvidence(citation, minScore, queryIntent) {
    if (!citation.rawPath || citation.evidenceKind === 'wiki') {
        return false;
    }
    if (!isReadableRegistryCitation(citation)) {
        return false;
    }
    if (citation.score.total < minScore) {
        return false;
    }
    const evidence = citationEvidenceForIntent(citation);
    if (!isEvidenceDomainConsistent(queryIntent, evidence, { minScore: 0.5, minMargin: 0.2 })) {
        return false;
    }
    if (isMeaningfulNonEmbeddingSupport(citation.score)) {
        return true;
    }
    if (!isEmbeddingOnlyScore(citation.score)) {
        return isStrongSemanticEvidence({
            intent: queryIntent,
            evidence,
        });
    }
    return isStrongSemanticEvidence({
        intent: queryIntent,
        evidence,
    });
}
function isRegistryAnswerEvidence(citation, answerableWikiIds) {
    if (citation.rawPath && citation.evidenceKind !== 'wiki') {
        return true;
    }
    return answerableWikiIds.has(citation.wikiId);
}
function isReadableRegistryCitation(citation) {
    const text = citation.excerpt.replace(/\s+/g, ' ').trim();
    if (text.length < 40) {
        return false;
    }
    const htmlTagCount = (text.match(/<\/?(?:td|tr|table|tbody|thead|th)\b/gi) ?? []).length;
    if (htmlTagCount >= 2) {
        return false;
    }
    const readableChars = (text.match(/[\p{L}\p{N}\u4e00-\u9fff]/gu) ?? []).length;
    return readableChars / Math.max(text.length, 1) >= 0.35;
}
function compareRegistryCitations(left, right, queryIntent) {
    const leftFit = scoreEvidenceIntentFit(queryIntent, citationEvidenceForIntent(left));
    const rightFit = scoreEvidenceIntentFit(queryIntent, citationEvidenceForIntent(right));
    return right.score.total - left.score.total
        || right.score.rerank - left.score.rerank
        || right.score.lexical - left.score.lexical
        || rightFit.margin - leftFit.margin
        || rightFit.score - leftFit.score
        || right.score.embedding - left.score.embedding
        || left.wikiId.localeCompare(right.wikiId);
}
function citationEvidenceForIntent(citation) {
    return {
        wikiId: citation.wikiId,
        wikiTitle: citation.wikiTitle,
        title: citation.title,
        heading: citation.heading,
        excerpt: citation.excerpt,
        score: citation.score,
    };
}
function round(value) {
    return Number(value.toFixed(6));
}
