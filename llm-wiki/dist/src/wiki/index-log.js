import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseWikiPageTarget, wikiSectionHeading, wikiSectionOrder } from './sections.js';
const INDEX_HEADER = '# Wiki 索引';
const LOG_HEADER = '# Wiki 日志';
const LEGACY_INDEX_HEADERS = new Set(['# Wiki Index']);
const LEGACY_LOG_HEADERS = new Set(['# Wiki Log']);
const LEGACY_INDEX_SECTION_HEADINGS = new Set([
    '## Sources',
    '## Entities',
    '## Concepts',
    '## Syntheses',
    '## Comparisons',
    '## Queries',
    '## Other',
]);
const fileWriteQueues = new Map();
export async function updateWikiIndex(knowledgeRoot, entries) {
    const indexPath = path.join(path.resolve(knowledgeRoot), 'wiki', 'index.md');
    const normalizedMutation = normalizeIndexMutation(entries);
    return serializeFileUpdate(indexPath, async () => {
        const nextContent = await buildIndexContent(indexPath, normalizedMutation);
        await atomicWriteFile(indexPath, nextContent);
        return indexPath;
    });
}
export async function appendWikiLog(knowledgeRoot, logEntry) {
    const logPath = path.join(path.resolve(knowledgeRoot), 'wiki', 'log.md');
    return serializeFileUpdate(logPath, async () => {
        const existingContent = await readTextFileOrEmpty(logPath);
        const existingLines = splitNonEmptyLines(existingContent)
            .filter((line) => line !== LOG_HEADER && !LEGACY_LOG_HEADERS.has(line) && !isTemplateProseLine(line));
        const nextLine = `${new Date().toISOString()}\t${JSON.stringify(logEntry.trim())}`;
        const nextContent = [LOG_HEADER, '', ...existingLines, nextLine].join('\n').trimEnd() + '\n';
        await atomicWriteFile(logPath, nextContent);
        return logPath;
    });
}
async function buildIndexContent(indexPath, mutation) {
    const existingContent = await readTextFileOrEmpty(indexPath);
    const existingLines = splitNonEmptyLines(existingContent)
        .filter((line) => line !== INDEX_HEADER && !LEGACY_INDEX_HEADERS.has(line) && !isIndexSectionHeading(line) && !isTemplateProseLine(line));
    const mergedEntries = existingLines.filter((line) => !mutation.removeEntries.includes(line));
    for (const entry of mutation.addEntries) {
        if (!mergedEntries.includes(entry)) {
            mergedEntries.push(entry);
        }
    }
    return [INDEX_HEADER, '', ...renderGroupedIndexEntries(mergedEntries)].join('\n').trimEnd() + '\n';
}
function normalizeEntries(entries) {
    return [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))];
}
function normalizeIndexMutation(entries) {
    if (Array.isArray(entries)) {
        return {
            addEntries: normalizeEntries(entries),
            removeEntries: [],
        };
    }
    return {
        addEntries: normalizeEntries(entries.addEntries ?? []),
        removeEntries: normalizeEntries(entries.removeEntries ?? []),
    };
}
function splitNonEmptyLines(value) {
    return value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}
function renderGroupedIndexEntries(entries) {
    const remaining = [...entries];
    const output = [];
    for (const section of wikiSectionOrder) {
        const heading = wikiSectionHeading(section);
        const group = remaining.filter((entry) => indexEntrySection(entry) === section);
        if (group.length === 0) {
            continue;
        }
        if (output.length > 0) {
            output.push('');
        }
        output.push(heading, ...group);
        removeEntries(remaining, group);
    }
    if (remaining.length > 0) {
        if (output.length > 0) {
            output.push('');
        }
        output.push('## 其他', ...remaining);
    }
    return output;
}
function removeEntries(target, entriesToRemove) {
    for (const entry of entriesToRemove) {
        const index = target.indexOf(entry);
        if (index >= 0) {
            target.splice(index, 1);
        }
    }
}
function isIndexSectionHeading(line) {
    return wikiSectionOrder.some((section) => wikiSectionHeading(section) === line)
        || line === '## 其他'
        || LEGACY_INDEX_SECTION_HEADINGS.has(line);
}
function isTemplateProseLine(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('>') || trimmed.startsWith('<!--');
}
function indexEntrySection(entry) {
    const match = entry.match(/^\s*[-*]\s+\[\[([^|\]]+)/);
    const parsedTarget = match?.[1] ? parseWikiPageTarget(match[1]) : null;
    return parsedTarget?.section ?? null;
}
async function readTextFileOrEmpty(filePath) {
    try {
        return await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (isMissingFileError(error)) {
            return '';
        }
        throw error;
    }
}
async function atomicWriteFile(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
}
async function serializeFileUpdate(filePath, operation) {
    const previousTail = fileWriteQueues.get(filePath) ?? Promise.resolve();
    const runOperation = previousTail.catch(() => undefined).then(operation);
    const nextTail = runOperation.then(() => undefined, () => undefined);
    fileWriteQueues.set(filePath, nextTail);
    try {
        return await runOperation;
    }
    finally {
        if (fileWriteQueues.get(filePath) === nextTail) {
            fileWriteQueues.delete(filePath);
        }
    }
}
function isMissingFileError(error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
