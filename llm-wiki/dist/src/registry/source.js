import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { extractTitle, normalizeWhitespace } from './helpers.js';
export async function summarizeSource(input) {
    if (/^[a-z]+:\/\//i.test(input.trim())) {
        return {
            kind: 'url',
            sha256: null,
            title: input.trim(),
            excerpt: input.trim(),
            searchText: input.trim(),
            sourceRole: 'ordinary',
        };
    }
    const absolutePath = path.resolve(input);
    try {
        const content = await readFile(absolutePath, 'utf8');
        return {
            kind: 'local-file',
            sha256: createHash('sha256').update(content).digest('hex'),
            title: extractTitle(content) || path.basename(absolutePath),
            excerpt: normalizeWhitespace(content).slice(0, 1200),
            searchText: `${path.basename(absolutePath)}\n${content}`,
            sourceRole: inferRegistrySourceRole(absolutePath, content),
        };
    }
    catch (error) {
        if (error.code !== 'EISDIR') {
            return {
                kind: 'unknown',
                sha256: null,
                title: path.basename(absolutePath),
                excerpt: absolutePath,
                searchText: absolutePath,
                sourceRole: 'ordinary',
            };
        }
    }
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right)).join('\n');
    return {
        kind: 'directory',
        sha256: createHash('sha256').update(names).digest('hex'),
        title: path.basename(absolutePath),
        excerpt: names.slice(0, 1200),
        searchText: `${path.basename(absolutePath)}\n${names}`,
        sourceRole: 'ordinary',
    };
}
export function inferRegistrySourceRole(filePath, content) {
    const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const title = extractTitle(content) || basename;
    const titleLooksLikeIndex = /^(index|contents?|目录|索引)$/i.test(title.trim()) || /(?:index|contents?|目录|索引)/i.test(title.trim()) || basename === 'index';
    if (!titleLooksLikeIndex) {
        return 'ordinary';
    }
    if (basename === 'index' && /(?:index|contents?|目录|索引)/i.test(title.trim())) {
        return 'source-map';
    }
    const body = content.replace(/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '');
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return 'source-map';
    }
    const navigationLines = lines.filter((line) => /^#{1,6}\s+/.test(line) || /^[-*+]\s+/.test(line) || /^\|.+\|$/.test(line) || /\[[^\]]+\]\([^)]*\)/.test(line) || /\[\[[^\]]+\]\]/.test(line) || /`[^`]+\.(?:md|markdown|txt)`/.test(line));
    return navigationLines.length / lines.length >= 0.5 ? 'source-map' : 'ordinary';
}
