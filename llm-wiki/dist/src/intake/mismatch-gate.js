import path from 'node:path';
import { tokenize } from '../retrieval/tokenize.js';
const GENERIC_SOURCE_TOKENS = new Set([
    'article',
    'articles',
    'chapter',
    'chapters',
    'content',
    'contents',
    'decoded',
    'doc',
    'docs',
    'document',
    'documents',
    'draft',
    'file',
    'final',
    'index',
    'knowledge',
    'markdown',
    'md',
    'note',
    'notes',
    'paper',
    'papers',
    'raw',
    'report',
    'source',
    'sources',
    'staged',
    'summary',
    'text',
    'txt',
]);
const MIN_SOURCE_TOPIC_TOKENS = 2;
const MIN_TITLE_TOPIC_TOKENS = 2;
const EVIDENCE_WINDOW_CHARS = 2_400;
export function detectSourceMetadataMismatch(artifact) {
    if (artifact.sourceKind === 'repo') {
        return null;
    }
    const sourceHint = sourceHintFromRef(artifact.sourceRef);
    const sourceTokens = topicTokens(sourceHint);
    if (sourceTokens.length < MIN_SOURCE_TOPIC_TOKENS) {
        return null;
    }
    const titleTokens = topicTokens(artifact.title);
    if (titleTokens.length < MIN_TITLE_TOPIC_TOKENS) {
        return null;
    }
    const titleOverlap = intersect(sourceTokens, titleTokens);
    if (titleOverlap.length > 0) {
        return null;
    }
    const evidenceWindow = artifact.content.slice(0, EVIDENCE_WINDOW_CHARS);
    const evidenceTokens = topicTokens(`${artifact.summary}\n${evidenceWindow}`);
    const evidenceOverlap = intersect(sourceTokens, evidenceTokens);
    if (evidenceOverlap.length > 0) {
        return null;
    }
    return {
        type: 'source-metadata-mismatch',
        severity: 'medium',
        reason: `Source identity hints (${sourceTokens.join(', ')}) do not match parsed title "${artifact.title}" or early evidence.`,
        sourceHint,
        parsedTitle: artifact.title,
        sourceTokens,
        titleTokens,
        titleOverlap,
        evidenceOverlap,
        evidence: [
            `Source hint: ${sourceHint}`,
            `Parsed title: ${artifact.title}`,
            `Source tokens: ${sourceTokens.join(', ')}`,
            `Parsed title tokens: ${titleTokens.join(', ')}`,
            `Early evidence tokens did not include source tokens within first ${EVIDENCE_WINDOW_CHARS} chars.`,
        ],
    };
}
function sourceHintFromRef(sourceRef) {
    if (/^https?:\/\//i.test(sourceRef)) {
        try {
            const url = new URL(sourceRef);
            const leaf = path.basename(url.pathname) || url.hostname;
            return decodeURIComponent(leaf.replace(/\.[^.]+$/, ''));
        }
        catch {
            return sourceRef;
        }
    }
    return path.basename(sourceRef, path.extname(sourceRef));
}
function topicTokens(value) {
    return [...new Set(tokenize(value).filter((token) => !GENERIC_SOURCE_TOKENS.has(token) && !/^\d+$/.test(token)))];
}
function intersect(left, right) {
    const rightSet = new Set(right);
    return left.filter((token) => rightSet.has(token));
}
