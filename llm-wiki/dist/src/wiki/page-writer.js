import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appendWikiLog, updateWikiIndex } from './index-log.js';
import { appendPageHistoryEntries, removePageHistoryForWikiFile } from './page-history.js';
export async function writeKnowledgeChanges(input) {
    const root = path.resolve(input.knowledgeRoot);
    const writtenFiles = [];
    const outputManifest = buildKnowledgeOutputManifest(input);
    await writeWikiPage(root, 'sources', input.sourcePage);
    writtenFiles.push(path.join(root, outputManifest.pageFiles[0]));
    await writeWikiPage(root, 'readings', input.readingPage);
    writtenFiles.push(path.join(root, 'wiki', 'readings', `${input.readingPage.slug}.md`));
    for (const page of input.entityPages) {
        await writeWikiPage(root, 'entities', page);
        writtenFiles.push(path.join(root, 'wiki', 'entities', `${page.slug}.md`));
    }
    for (const page of input.conceptPages) {
        await writeWikiPage(root, 'concepts', page);
        writtenFiles.push(path.join(root, 'wiki', 'concepts', `${page.slug}.md`));
    }
    for (const page of input.synthesisPages ?? []) {
        await writeWikiPage(root, 'syntheses', page);
        writtenFiles.push(path.join(root, 'wiki', 'syntheses', `${page.slug}.md`));
    }
    const removedStalePageFiles = await removeStalePages(root, input.previousOutputManifest, outputManifest);
    writtenFiles.push(await updateWikiIndex(root, {
        addEntries: outputManifest.indexEntries,
        removeEntries: input.previousOutputManifest?.indexEntries.filter((entry) => !outputManifest.indexEntries.includes(entry) && wasStaleIndexEntryRemoved(entry, removedStalePageFiles)) ?? [],
    }));
    writtenFiles.push(await appendWikiLog(root, input.logEntry));
    writtenFiles.push(...await appendPageHistoryEntries(root, buildPageHistoryEntries(input), input.logEntry));
    return {
        writtenFiles,
        outputManifest,
    };
}
export function buildKnowledgeOutputManifest(input) {
    const currentPageFiles = [
        path.join('wiki', 'sources', `${input.sourcePage.slug}.md`).replace(/\\/g, '/'),
        path.join('wiki', 'readings', `${input.readingPage.slug}.md`).replace(/\\/g, '/'),
        ...input.entityPages.map((page) => path.join('wiki', 'entities', `${page.slug}.md`).replace(/\\/g, '/')),
        ...input.conceptPages.map((page) => path.join('wiki', 'concepts', `${page.slug}.md`).replace(/\\/g, '/')),
        ...(input.synthesisPages ?? []).map((page) => path.join('wiki', 'syntheses', `${page.slug}.md`).replace(/\\/g, '/')),
    ];
    return {
        pageFiles: currentPageFiles,
        indexEntries: normalizeEntries(input.indexEntries),
        pageSnapshots: buildPageSnapshots(input, currentPageFiles),
    };
}
export async function restoreWikiPageSnapshot(knowledgeRoot, snapshot) {
    validateRelativeWikiPagePath(snapshot.filePath);
    const filePath = path.join(path.resolve(knowledgeRoot), snapshot.filePath);
    await atomicWriteFile(filePath, formatPageMarkdown({
        slug: path.basename(snapshot.filePath, '.md'),
        title: snapshot.title,
        body: snapshot.body,
    }, sectionFromSnapshotPath(snapshot.filePath)));
    return filePath;
}
export async function removeWikiPageFile(knowledgeRoot, relativeFilePath) {
    validateRelativeWikiPagePath(relativeFilePath);
    await rm(path.join(path.resolve(knowledgeRoot), relativeFilePath), { force: true });
}
const SAFE_SLUG_PATTERN = /^[a-z0-9-]+$/;
async function writeWikiPage(knowledgeRoot, section, page) {
    validateSlug(page.slug);
    const filePath = path.join(knowledgeRoot, 'wiki', section, `${page.slug}.md`);
    const markdown = await preparePageMarkdownForWrite(filePath, formatPageMarkdown(page, section), section);
    await atomicWriteFile(filePath, markdown);
    return filePath;
}
async function preparePageMarkdownForWrite(filePath, incomingMarkdown, section) {
    if (section !== 'entities' && section !== 'concepts' && section !== 'syntheses') {
        return incomingMarkdown;
    }
    let existingMarkdown;
    try {
        existingMarkdown = await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return incomingMarkdown;
        }
        throw error;
    }
    if (!hasManagedSemanticFrontmatter(existingMarkdown, section)) {
        throw new Error(`Refusing to overwrite unmanaged semantic page: ${filePath}`);
    }
    return mergeManagedSemanticPage(existingMarkdown, incomingMarkdown);
}
async function removeStalePages(knowledgeRoot, previousOutputManifest, currentOutputManifest) {
    const stalePageFiles = previousOutputManifest?.pageFiles.filter((filePath) => !currentOutputManifest.pageFiles.includes(filePath) && isSourceOwnedPageFile(filePath)) ?? [];
    const removedPageFiles = [];
    for (const filePath of stalePageFiles) {
        if (!await canRemoveStalePage(knowledgeRoot, filePath, previousOutputManifest)) {
            continue;
        }
        await rm(path.join(knowledgeRoot, filePath), { force: true });
        await removePageHistoryForWikiFile(knowledgeRoot, filePath);
        removedPageFiles.push(filePath);
    }
    return removedPageFiles;
}
// Stale cleanup is scoped to source-owned pages. Source/reading pages are private
// to one source. Semantic pages are only removable when the previous manifest
// snapshot still matches the current managed file, so human-edited pages survive.
function isSourceOwnedPageFile(filePath) {
    const normalizedPath = path.normalize(filePath);
    const relativeToWiki = normalizedPath.startsWith(`wiki${path.sep}`)
        ? normalizedPath.slice(`wiki${path.sep}`.length)
        : normalizedPath;
    const [section] = relativeToWiki.split(path.sep);
    return section === 'sources' || section === 'readings' || section === 'entities' || section === 'concepts' || section === 'syntheses';
}
async function canRemoveStalePage(knowledgeRoot, filePath, previousOutputManifest) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.startsWith('wiki/sources/') || normalizedPath.startsWith('wiki/readings/')) {
        return true;
    }
    const section = sectionFromSnapshotPath(normalizedPath);
    if (section !== 'entities' && section !== 'concepts' && section !== 'syntheses') {
        return false;
    }
    const snapshot = previousOutputManifest?.pageSnapshots.find((candidate) => candidate.filePath === normalizedPath);
    if (!snapshot) {
        return false;
    }
    let currentMarkdown;
    try {
        currentMarkdown = await readFile(path.join(knowledgeRoot, normalizedPath), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return true;
        }
        throw error;
    }
    if (!hasManagedSemanticFrontmatter(currentMarkdown, section)) {
        return false;
    }
    if (snapshot.body.trimStart().startsWith('---\n')) {
        return currentMarkdown.trimEnd() === snapshot.body.trimEnd();
    }
    return stripWikiFrontmatter(currentMarkdown).trimEnd() === snapshot.body.trimEnd();
}
function wasStaleIndexEntryRemoved(entry, removedPageFiles) {
    const targetFile = indexEntryTargetFile(entry);
    return Boolean(targetFile && removedPageFiles.includes(targetFile));
}
function indexEntryTargetFile(entry) {
    const match = entry.trim().match(/^[-*]\s+\[\[((?:sources|readings|entities|concepts|syntheses)\/[^|\]]+)\|[^\]]+\]\]$/);
    return match ? `wiki/${match[1]}.md` : null;
}
function hasManagedSemanticFrontmatter(markdown, section) {
    const typeBySection = {
        entities: 'entity',
        concepts: 'concept',
        syntheses: 'synthesis',
    };
    const type = typeBySection[section];
    return new RegExp(`^---\\n[\\s\\S]*\\ntype: ${JSON.stringify(type)}\\n[\\s\\S]*\\n---\\n?`, 'u').test(markdown);
}
function mergeManagedSemanticPage(existingMarkdown, incomingMarkdown) {
    const incomingSourceIds = frontmatterJsonArray(incomingMarkdown, 'sources');
    const mergedFrontmatter = replaceFrontmatterJsonArray(existingMarkdown, 'sources', unique([...frontmatterJsonArray(existingMarkdown, 'sources'), ...incomingSourceIds]));
    const existingBody = stripWikiFrontmatter(mergedFrontmatter).trimEnd();
    const incomingBody = stripWikiFrontmatter(incomingMarkdown).trimEnd();
    const mergedBody = mergeMarkdownSections(existingBody, incomingBody, ['## 来源', '## 属性', '## 原文证据']);
    return `${frontmatterBlock(mergedFrontmatter)}\n${mergedBody}\n`;
}
function mergeMarkdownSections(baseBody, incomingBody, headings) {
    return headings.reduce((body, heading) => replaceSectionLines(body, heading, unique([
        ...sectionLines(body, heading),
        ...sectionLines(incomingBody, heading),
    ])), baseBody);
}
function sectionLines(body, heading) {
    const lines = body.split('\n');
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start < 0)
        return [];
    const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    return lines.slice(start + 1, end < 0 ? lines.length : end).filter((line) => line.trim().length > 0);
}
function replaceSectionLines(body, heading, lines) {
    const bodyLines = body.split('\n');
    const start = bodyLines.findIndex((line) => line.trim() === heading);
    if (start < 0) {
        return [...bodyLines, '', heading, ...lines].join('\n').trimEnd();
    }
    const end = bodyLines.findIndex((line, index) => index > start && line.startsWith('## '));
    return [
        ...bodyLines.slice(0, start + 1),
        ...lines,
        ...(end < 0 ? [] : bodyLines.slice(end)),
    ].join('\n').trimEnd();
}
function frontmatterBlock(markdown) {
    if (!markdown.startsWith('---\n')) {
        return '';
    }
    const end = markdown.indexOf('\n---\n', 4);
    return end < 0 ? '' : markdown.slice(0, end + '\n---'.length);
}
function frontmatterJsonArray(markdown, key) {
    const match = frontmatterBlock(markdown).match(new RegExp(`^${key}: (.+)$`, 'm'));
    if (!match)
        return [];
    try {
        const parsed = JSON.parse(match[1]);
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
    }
    catch {
        return [];
    }
}
function replaceFrontmatterJsonArray(markdown, key, values) {
    const block = frontmatterBlock(markdown);
    if (!block)
        return markdown;
    const replacement = `${key}: ${JSON.stringify(values)}`;
    const nextBlock = new RegExp(`^${key}: .+$`, 'm').test(block)
        ? block.replace(new RegExp(`^${key}: .+$`, 'm'), replacement)
        : block.replace(/\n---$/u, `\n${replacement}\n---`);
    return `${nextBlock}${markdown.slice(block.length)}`;
}
function stripWikiFrontmatter(markdown) {
    if (!markdown.startsWith('---\n')) {
        return markdown;
    }
    const end = markdown.indexOf('\n---\n', 4);
    if (end < 0) {
        return markdown;
    }
    return markdown.slice(end + '\n---\n'.length);
}
function unique(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
function buildPageSnapshots(input, currentPageFiles) {
    const sourceSnapshots = [{
            section: 'sources',
            page: input.sourcePage,
        }];
    const readingSnapshots = [{
            section: 'readings',
            page: input.readingPage,
        }];
    const entitySnapshots = input.entityPages.map((page) => ({
        section: 'entities',
        page,
    }));
    const conceptSnapshots = input.conceptPages.map((page) => ({
        section: 'concepts',
        page,
    }));
    const synthesisSnapshots = (input.synthesisPages ?? []).map((page) => ({
        section: 'syntheses',
        page,
    }));
    return [...sourceSnapshots, ...readingSnapshots, ...entitySnapshots, ...conceptSnapshots, ...synthesisSnapshots].map(({ section, page }) => {
        const filePath = path.join('wiki', section, `${page.slug}.md`).replace(/\\/g, '/');
        const indexEntry = buildIndexEntry(section, page);
        return {
            filePath,
            title: page.title,
            body: page.body,
            indexEntry,
        };
    }).filter((snapshot) => currentPageFiles.includes(snapshot.filePath));
}
function buildPageHistoryEntries(input) {
    return [
        { section: 'sources', slug: input.sourcePage.slug, title: input.sourcePage.title },
        { section: 'readings', slug: input.readingPage.slug, title: input.readingPage.title },
        ...input.entityPages.map((page) => ({ section: 'entities', slug: page.slug, title: page.title })),
        ...input.conceptPages.map((page) => ({ section: 'concepts', slug: page.slug, title: page.title })),
        ...(input.synthesisPages ?? []).map((page) => ({ section: 'syntheses', slug: page.slug, title: page.title })),
    ];
}
function buildIndexEntry(section, page) {
    return `- [[${section}/${page.slug}|${page.title}]]`;
}
function normalizeEntries(entries) {
    return [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))];
}
function formatPageMarkdown(page, section) {
    const normalizedBody = page.body.trim();
    const body = normalizedBody.startsWith('# ') || normalizedBody.startsWith('---\n')
        ? normalizedBody
        : [`# ${page.title}`, '', normalizedBody].join('\n').trimEnd();
    if (body.startsWith('---\n')) {
        return `${body}\n`;
    }
    return [formatWikiFrontmatter(page, section), body].join('\n').trimEnd() + '\n';
}
function formatWikiFrontmatter(page, section) {
    const now = new Date().toISOString();
    const typeBySection = {
        sources: 'source',
        readings: 'reading',
        entities: 'entity',
        concepts: 'concept',
        syntheses: 'synthesis',
    };
    const sources = page.artifactId ? [page.artifactId] : [];
    const tags = page.topics ?? [];
    return [
        '---',
        `title: ${JSON.stringify(page.title)}`,
        `created: ${JSON.stringify(now)}`,
        `updated: ${JSON.stringify(now)}`,
        `type: ${JSON.stringify(typeBySection[section])}`,
        `tags: ${JSON.stringify(tags)}`,
        `sources: ${JSON.stringify(sources)}`,
        'confidence: "medium"',
        'contested: false',
        '---',
    ].join('\n');
}
function sectionFromSnapshotPath(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.startsWith('wiki/readings/'))
        return 'readings';
    if (normalized.startsWith('wiki/entities/'))
        return 'entities';
    if (normalized.startsWith('wiki/concepts/'))
        return 'concepts';
    if (normalized.startsWith('wiki/syntheses/'))
        return 'syntheses';
    return 'sources';
}
async function atomicWriteFile(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
}
function validateRelativeWikiPagePath(relativeFilePath) {
    const normalized = path.posix.normalize(relativeFilePath.replace(/\\/g, '/'));
    if (!normalized.startsWith('wiki/') || normalized.includes('../') || !normalized.endsWith('.md')) {
        throw new Error(`Invalid wiki page path: ${relativeFilePath}`);
    }
}
function validateSlug(slug) {
    if (!SAFE_SLUG_PATTERN.test(slug)) {
        throw new Error(`Invalid slug: ${slug}`);
    }
}
