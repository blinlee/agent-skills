import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadIndexedPages, parseWikiLinks, resolveWikiLink } from '../query/query.js';
export async function runBuildIndex(input) {
    const root = path.resolve(input.knowledgeRoot);
    const generatedAt = new Date().toISOString();
    const indexedPages = await loadIndexedPages(root);
    const pages = [];
    const chunks = [];
    const links = [];
    const backlinks = new Map();
    const pageContent = new Map();
    const skippedMissingPages = [];
    for (const page of indexedPages) {
        try {
            pageContent.set(page.target, await readFile(page.filePath, 'utf8'));
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
            skippedMissingPages.push(page.target);
        }
    }
    const missingTargets = new Set(skippedMissingPages);
    for (const page of indexedPages) {
        const content = pageContent.get(page.target);
        if (content === undefined) {
            continue;
        }
        const parsedLinks = parseWikiLinks(content);
        const outgoingLinks = [];
        for (const link of parsedLinks) {
            const resolved = resolveWikiLink(link.rawTarget, indexedPages);
            if (resolved.status === 'resolved' && !missingTargets.has(resolved.page.target)) {
                outgoingLinks.push(resolved.page.target);
                const owners = backlinks.get(resolved.page.target) ?? new Set();
                owners.add(page.target);
                backlinks.set(resolved.page.target, owners);
                links.push({
                    from: page.target,
                    to: resolved.page.target,
                    rawTarget: link.rawTarget,
                    title: link.title,
                    status: 'resolved',
                    candidates: [resolved.page.target],
                });
            }
            else if (resolved.status === 'resolved' && missingTargets.has(resolved.page.target)) {
                links.push({
                    from: page.target,
                    to: null,
                    rawTarget: link.rawTarget,
                    title: link.title,
                    status: 'missing',
                    candidates: [resolved.page.target],
                });
            }
            else if (resolved.status === 'ambiguous') {
                links.push({
                    from: page.target,
                    to: null,
                    rawTarget: link.rawTarget,
                    title: link.title,
                    status: 'ambiguous',
                    candidates: resolved.matches.map((match) => match.target),
                });
            }
            else {
                links.push({
                    from: page.target,
                    to: null,
                    rawTarget: link.rawTarget,
                    title: link.title,
                    status: 'missing',
                    candidates: [],
                });
            }
        }
        pages.push({
            target: page.target,
            title: page.title,
            section: page.section,
            slug: page.slug,
            filePath: page.filePath,
            sha256: createHash('sha256').update(content).digest('hex'),
            lineCount: content.split('\n').length,
            headings: extractHeadings(content).map((heading) => heading.text),
            outgoingLinks: [...new Set(outgoingLinks)].sort((left, right) => left.localeCompare(right)),
        });
        chunks.push(...chunkPage(page.target, content));
    }
    const indexDirectory = path.join(root, 'system', 'index');
    const files = {
        pages: path.join(indexDirectory, 'pages.json'),
        chunks: path.join(indexDirectory, 'chunks.json'),
        links: path.join(indexDirectory, 'links.json'),
    };
    await mkdir(indexDirectory, { recursive: true });
    await writeJsonFile(files.pages, { version: 1, knowledgeRoot: root, generatedAt, pages });
    await writeJsonFile(files.chunks, { version: 1, knowledgeRoot: root, generatedAt, chunks });
    await writeJsonFile(files.links, {
        version: 1,
        knowledgeRoot: root,
        generatedAt,
        links,
        backlinks: Object.fromEntries([...backlinks.entries()].map(([target, owners]) => [target, [...owners].sort((left, right) => left.localeCompare(right))])),
    });
    return {
        knowledgeRoot: root,
        generatedAt,
        pageCount: pages.length,
        chunkCount: chunks.length,
        linkCount: links.length,
        backlinkCount: backlinks.size,
        skippedMissingPages,
        files,
    };
}
function chunkPage(pageTarget, content) {
    const lines = content.split('\n');
    const headingLines = extractHeadings(content);
    const boundaries = headingLines.length > 0
        ? headingLines.map((heading) => ({ ...heading, lineIndex: heading.lineIndex }))
        : [{ level: 1, text: 'Document', lineIndex: 0 }];
    const chunks = [];
    const usedIds = new Map();
    for (let index = 0; index < boundaries.length; index += 1) {
        const current = boundaries[index];
        const next = boundaries[index + 1];
        const startLine = current.lineIndex + 1;
        const endLine = next ? next.lineIndex : lines.length;
        const text = lines.slice(current.lineIndex, endLine).join('\n').trim();
        if (!text) {
            continue;
        }
        const baseId = `${pageTarget}#${slugify(current.text || `chunk-${index + 1}`)}`;
        chunks.push({
            id: uniqueChunkId(baseId, usedIds),
            pageTarget,
            heading: current.text || 'Document',
            level: current.level,
            startLine,
            endLine,
            text: text.slice(0, 4000),
            links: parseWikiLinks(text).map((link) => link.rawTarget),
        });
    }
    return chunks;
}
function uniqueChunkId(baseId, usedIds) {
    const count = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, count + 1);
    return count === 0 ? baseId : `${baseId}-${count + 1}`;
}
function extractHeadings(content) {
    return content.split('\n').flatMap((line, lineIndex) => {
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        return match ? [{ level: match[1].length, text: match[2].trim(), lineIndex }] : [];
    });
}
function slugify(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'chunk';
}
async function writeJsonFile(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
