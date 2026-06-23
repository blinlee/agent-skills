import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
const PAGE_HISTORY_HEADER = '# Page Log';
const fileWriteQueues = new Map();
const SAFE_SLUG_PATTERN = /^[a-z0-9-]+$/;
export async function appendPageHistoryEntries(knowledgeRoot, pages, message) {
    const root = path.resolve(knowledgeRoot);
    const writtenFiles = [];
    for (const page of pages) {
        validatePageHistoryEntry(page);
        const filePath = pageHistoryPath(root, page.section, page.slug);
        await serializeFileUpdate(filePath, async () => {
            const existingContent = await readTextFileOrEmpty(filePath);
            const existingLines = existingContent
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && line !== PAGE_HISTORY_HEADER);
            const event = {
                event: 'upsert',
                target: `${page.section}/${page.slug}`,
                title: page.title,
                message: message.trim(),
            };
            const nextLine = `${new Date().toISOString()}\t${JSON.stringify(event)}`;
            const nextContent = [PAGE_HISTORY_HEADER, '', ...existingLines, nextLine].join('\n').trimEnd() + '\n';
            await atomicWriteFile(filePath, nextContent);
        });
        writtenFiles.push(filePath);
    }
    return writtenFiles;
}
export async function removePageHistoryForWikiFile(knowledgeRoot, relativeFilePath) {
    const target = parseRelativeWikiPagePath(relativeFilePath);
    if (!target) {
        return;
    }
    await rm(pageHistoryPath(path.resolve(knowledgeRoot), target.section, target.slug), { force: true });
}
export function pageHistoryPath(knowledgeRoot, section, slug) {
    return path.join(path.resolve(knowledgeRoot), 'wiki', section, slug, 'log.md');
}
async function readTextFileOrEmpty(filePath) {
    try {
        return await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
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
function validatePageHistoryEntry(page) {
    if (!SAFE_SLUG_PATTERN.test(page.slug)) {
        throw new Error(`Invalid slug for page history: ${page.slug}`);
    }
}
function parseRelativeWikiPagePath(relativeFilePath) {
    const normalized = relativeFilePath.replace(/\\/g, '/');
    const match = /^wiki\/(sources|readings|entities|concepts|syntheses)\/([a-z0-9-]+)\.md$/u.exec(normalized);
    return match ? { section: match[1], slug: match[2] } : null;
}
