import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exists } from '../shared/fs.js';
export function normalizeWikiId(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
export function titleFromId(id) {
    return id.split(/[-_.]+/g).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || id;
}
export function normalizeStringList(values) {
    return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
}
export async function ensureTextFile(filePath, initialValue) {
    await mkdir(path.dirname(filePath), { recursive: true });
    if (await exists(filePath)) {
        return;
    }
    await writeFile(filePath, initialValue, 'utf8');
}
export async function appendJsonLine(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const existing = await exists(filePath) ? await readFile(filePath, 'utf8') : '';
    const needsNewline = existing.length > 0 && !existing.endsWith('\n');
    await writeFile(filePath, `${existing}${needsNewline ? '\n' : ''}${JSON.stringify(value)}\n`, 'utf8');
}
export const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'what', 'with', 'this', 'that', 'into', 'about',
    'can', 'do', 'does', 'our', 'their', 'these', 'those', 'use', 'used', 'using', 'we', 'you',
]);
const ASCII_TOKEN_PATTERN = /[a-z0-9]+/g;
export function tokenize(text) {
    return normalizeWhitespace(text)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .flatMap(extractSearchTokens)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}
function extractSearchTokens(token) {
    const asciiTokens = token.match(ASCII_TOKEN_PATTERN) ?? [];
    if (asciiTokens.length === 0) {
        return [token];
    }
    const tokens = [...asciiTokens];
    const stripped = token.replace(ASCII_TOKEN_PATTERN, ' ').trim();
    if (stripped && stripped.length !== token.length) {
        tokens.push(stripped);
    }
    return tokens;
}
export function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
export function extractTitle(content) {
    const heading = content.match(/^#\s+(.+)$/m);
    return heading?.[1]?.trim() || null;
}
export function normalizeWikiProfile(wiki) {
    const scopeCore = normalizeStringList(wiki.scopeCore ?? wiki.scope ?? []);
    const scopeAdjacent = normalizeStringList(wiki.scopeAdjacent ?? []);
    return {
        ...wiki,
        scopeCore,
        scopeAdjacent,
        scope: [...new Set([...scopeCore, ...scopeAdjacent, ...(wiki.scope ?? [])])],
        outOfScope: normalizeStringList(wiki.outOfScope ?? []),
        aliases: normalizeStringList(wiki.aliases ?? []),
        conceptAliases: wiki.conceptAliases ?? [],
        granularity: wiki.granularity ?? defaultGranularityPolicy(),
        exampleAccept: wiki.exampleAccept ?? [],
        exampleReject: wiki.exampleReject ?? [],
        profileNotes: wiki.profileNotes ?? [],
    };
}
export function defaultGranularityPolicy() {
    return {
        preferredLevel: 'field',
        splitWhen: [
            '有独立术语体系',
            '查询意图不同',
            '材料质量或审核标准不同',
            '预期会持续积累同类材料',
            '强行放入已有 wiki 会产生高污染风险',
        ],
        doNotSplitWhen: [
            '只是一个技术变体',
            '通常和已有 wiki 一起查询',
            '共享同一批来源和概念',
            '只有单个材料且没有后续积累预期',
        ],
    };
}
