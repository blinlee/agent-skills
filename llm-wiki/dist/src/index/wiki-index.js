import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../shared/fs.js';
import { buildEntityConceptGraphIndex } from '../retrieval/entity-graph.js';
import { loadEntityExtractionIndex, supplementalEntityTextsByChunkId } from '../retrieval/entity-extract.js';
import { loadKeyInfoIndex, supplementalKeyInfoTextsByChunkId } from '../retrieval/key-info.js';
import { buildLexicalIndex } from '../retrieval/lexical.js';
import { approximateTokenCount } from '../retrieval/tokenize.js';
import { readRawManifest, stripManagedRawFrontmatter } from '../intake/raw-store.js';
import { loadIndexedPages, parseWikiLinks, resolveWikiLink } from '../wiki/links.js';
import { extractHeadings } from './headings.js';
import { chunkPage, extractPrivacyMetadata } from './wiki-chunking.js';
const CHUNKING_SCHEMA = 'llm-wiki.parent-child.v1';
export async function runBuildIndex(input) {
    const root = path.resolve(input.knowledgeRoot);
    const generatedAt = new Date().toISOString();
    const indexedPages = await loadIndexedPages(root);
    const indexDirectory = path.join(root, 'system', 'index');
    const files = {
        pages: path.join(indexDirectory, 'pages.json'),
        chunks: path.join(indexDirectory, 'chunks.json'),
        links: path.join(indexDirectory, 'links.json'),
        lexical: path.join(indexDirectory, 'lexical.json'),
        topics: path.join(indexDirectory, 'topics.json'),
        entityGraph: path.join(indexDirectory, 'entity-graph.json'),
        fileHashes: path.join(indexDirectory, 'file-hashes.json'),
    };
    const targetSignature = indexedTargetSignature(indexedPages);
    const previous = await loadPreviousIndexArtifacts(files, targetSignature);
    const rawManifest = await readRawManifest(root);
    const pages = [];
    const chunks = [];
    const parentSpans = [];
    const links = [];
    const backlinks = new Map();
    const pageContent = new Map();
    const currentFileHashes = {};
    const skippedMissingPages = [];
    let reusedPageCount = 0;
    let rebuiltPageCount = 0;
    for (const page of indexedPages) {
        try {
            const content = await readFile(page.filePath, 'utf8');
            pageContent.set(page.target, content);
            currentFileHashes[page.target] = {
                filePath: page.filePath,
                sha256: hashText(content),
                reused: false,
            };
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
        const pageHash = currentFileHashes[page.target]?.sha256 ?? hashText(content);
        const evidenceSource = await resolvePageEvidenceSource({
            root,
            page,
            pageContent: content,
            rawManifest,
        });
        const currentHash = evidenceSource.evidenceKind === 'raw'
            ? hashText(`${CHUNKING_SCHEMA}\n${pageHash}\nraw:${evidenceSource.rawPath}\n${evidenceSource.contentHash}`)
            : hashText(`${CHUNKING_SCHEMA}\n${pageHash}`);
        const reused = reusablePageArtifacts(previous, page.target, currentHash);
        if (reused) {
            const linkArtifacts = buildPageLinkArtifacts(page, content, indexedPages, missingTargets);
            pages.push({
                ...reused.page,
                title: page.title,
                section: page.section,
                slug: page.slug,
                filePath: page.filePath,
                sha256: pageHash,
                outgoingLinks: linkArtifacts.outgoingLinks,
            });
            chunks.push(...reused.chunks.map((chunk) => ({ ...chunk, filePath: chunk.rawPath ?? page.filePath })));
            parentSpans.push(...reused.parentSpans.map((span) => ({ ...span, filePath: span.rawPath ?? page.filePath })));
            for (const link of linkArtifacts.links) {
                pushLink(links, backlinks, link);
            }
            currentFileHashes[page.target] = {
                filePath: page.filePath,
                sha256: currentHash,
                reused: true,
            };
            reusedPageCount += 1;
            continue;
        }
        rebuiltPageCount += 1;
        const linkArtifacts = buildPageLinkArtifacts(page, content, indexedPages, missingTargets);
        pages.push({
            target: page.target,
            title: page.title,
            section: page.section,
            slug: page.slug,
            filePath: page.filePath,
            sha256: pageHash,
            lineCount: content.split('\n').length,
            headings: extractHeadings(content).map((heading) => heading.text),
            outgoingLinks: linkArtifacts.outgoingLinks,
        });
        for (const link of linkArtifacts.links) {
            pushLink(links, backlinks, link);
        }
        const chunkArtifacts = chunkPage(page, evidenceSource);
        chunks.push(...chunkArtifacts.chunks);
        parentSpans.push(...chunkArtifacts.parentSpans);
        currentFileHashes[page.target] = {
            filePath: page.filePath,
            sha256: currentHash,
            reused: false,
        };
    }
    chunks.push(...await buildReviewProposalChunks(root));
    const entityExtractions = await loadEntityExtractionIndex(root);
    const keyInfo = await loadKeyInfoIndex(root);
    const supplementalTextsByChunkId = mergeSupplementalTexts([
        supplementalEntityTextsByChunkId({
            records: entityExtractions.records,
            chunks,
        }),
        supplementalKeyInfoTextsByChunkId({
            records: keyInfo.records,
            chunks,
        }),
    ]);
    const lexical = buildLexicalIndex({
        knowledgeRoot: root,
        generatedAt,
        chunks,
        supplementalTextsByChunkId,
    });
    const topicMetadata = await loadTopicMetadata(root);
    const topics = buildTopicIndex(chunks, topicMetadata);
    const entityGraph = buildEntityConceptGraphIndex({
        knowledgeRoot: root,
        generatedAt,
        chunks,
        entityExtractions: entityExtractions.records,
        pageLinks: links,
        topicEdges: topicMetadata.categoryEdges
            .filter((edge) => edge.status === undefined || edge.status === 'accepted')
            .map((edge) => ({ from: edge.from, to: edge.to })),
    });
    await mkdir(indexDirectory, { recursive: true });
    await writeJsonFile(files.pages, { version: 1, knowledgeRoot: root, generatedAt, pages });
    await writeJsonFile(files.chunks, { version: 2, schema: 'llm-wiki.chunks.v2', chunkingSchema: CHUNKING_SCHEMA, knowledgeRoot: root, generatedAt, parentSpans, chunks });
    await writeJsonFile(files.lexical, lexical);
    await writeJsonFile(files.links, {
        version: 1,
        knowledgeRoot: root,
        generatedAt,
        links,
        backlinks: Object.fromEntries([...backlinks.entries()].map(([target, owners]) => [target, [...owners].sort((left, right) => left.localeCompare(right))])),
    });
    await writeJsonFile(files.entityGraph, entityGraph);
    await writeJsonFile(files.fileHashes, {
        version: 1,
        schema: 'llm-wiki.file-hashes.v1',
        knowledgeRoot: root,
        generatedAt,
        targetSignature,
        files: currentFileHashes,
    });
    await writeJsonFile(files.topics, {
        version: 1,
        schema: 'llm-wiki.topics.v1',
        knowledgeRoot: root,
        generatedAt,
        topics,
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
        reusedPageCount,
        rebuiltPageCount,
    };
}
async function loadPreviousIndexArtifacts(files, targetSignature) {
    const fileHashes = await readJsonFile(files.fileHashes, null);
    if (!isFileHashIndexState(fileHashes) || fileHashes.targetSignature !== targetSignature) {
        return null;
    }
    const [pages, chunks] = await Promise.all([
        readJsonFile(files.pages, null),
        readJsonFile(files.chunks, null),
    ]);
    if (!pages || !chunks) {
        return null;
    }
    return {
        fileHashes,
        pagesByTarget: new Map(pages.pages.map((page) => [page.target, page])),
        chunksByPageTarget: groupBy(chunks.chunks, (chunk) => chunk.pageTarget),
        parentSpansByPageTarget: groupBy(chunks.parentSpans ?? [], (span) => span.pageTarget),
    };
}
function reusablePageArtifacts(previous, pageTarget, currentHash) {
    if (!previous) {
        return null;
    }
    const previousHash = previous.fileHashes.files[pageTarget]?.sha256;
    if (previousHash !== currentHash) {
        return null;
    }
    const page = previous.pagesByTarget.get(pageTarget);
    if (!page) {
        return null;
    }
    return {
        page,
        chunks: previous.chunksByPageTarget.get(pageTarget) ?? [],
        parentSpans: previous.parentSpansByPageTarget.get(pageTarget) ?? [],
    };
}
function buildPageLinkArtifacts(page, content, indexedPages, missingTargets) {
    const links = [];
    const outgoingLinks = [];
    for (const link of parseWikiLinks(content)) {
        const resolved = resolveWikiLink(link.rawTarget, indexedPages);
        if (resolved.status === 'resolved' && !missingTargets.has(resolved.page.target)) {
            outgoingLinks.push(resolved.page.target);
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
    return {
        links,
        outgoingLinks: [...new Set(outgoingLinks)].sort((left, right) => left.localeCompare(right)),
    };
}
function pushLink(links, backlinks, link) {
    links.push(link);
    if (!link.to || link.status !== 'resolved') {
        return;
    }
    const owners = backlinks.get(link.to) ?? new Set();
    owners.add(link.from);
    backlinks.set(link.to, owners);
}
function indexedTargetSignature(indexedPages) {
    return hashText(indexedPages.map((page) => `${page.target}\t${page.filePath}\t${page.title}`).sort().join('\n'));
}
function hashText(value) {
    return createHash('sha256').update(value).digest('hex');
}
function isFileHashIndexState(value) {
    if (!value || typeof value !== 'object')
        return false;
    const candidate = value;
    return candidate.version === 1
        && candidate.schema === 'llm-wiki.file-hashes.v1'
        && typeof candidate.targetSignature === 'string'
        && Boolean(candidate.files)
        && typeof candidate.files === 'object'
        && !Array.isArray(candidate.files);
}
function groupBy(items, keyFor) {
    const grouped = new Map();
    for (const item of items) {
        const key = keyFor(item);
        grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return grouped;
}
function mergeSupplementalTexts(inputs) {
    const merged = new Map();
    for (const input of inputs) {
        for (const [chunkId, text] of input) {
            const existing = merged.get(chunkId);
            merged.set(chunkId, existing ? `${existing}\n${text}` : text);
        }
    }
    return merged;
}
async function loadTopicMetadata(root) {
    const [aliasesRaw, redirectsRaw, categoryGraphRaw] = await Promise.all([
        readOptionalText(path.join(root, 'taxonomy', 'aliases.json')),
        readOptionalText(path.join(root, 'taxonomy', 'redirects.json')),
        readOptionalText(path.join(root, 'taxonomy', 'category-graph.json')),
    ]);
    return {
        aliases: parseStringRecord(aliasesRaw, 'aliases'),
        redirects: parseStringRecord(redirectsRaw, 'redirects'),
        categoryEdges: parseCategoryEdges(categoryGraphRaw),
    };
}
async function readOptionalText(filePath) {
    try {
        return await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function parseStringRecord(raw, key) {
    if (!raw) {
        return {};
    }
    const parsed = JSON.parse(raw);
    const value = parsed[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return Object.fromEntries(Object.entries(value).filter((entry) => typeof entry[1] === 'string'));
}
function parseCategoryEdges(raw) {
    if (!raw) {
        return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.edges)) {
        return [];
    }
    return parsed.edges.flatMap((edge) => {
        if (!edge || typeof edge !== 'object') {
            return [];
        }
        const record = edge;
        if (typeof record.from !== 'string' || typeof record.to !== 'string') {
            return [];
        }
        return [{
                from: record.from,
                to: record.to,
                status: typeof record.status === 'string' ? record.status : undefined,
            }];
    });
}
function buildTopicIndex(chunks, metadata) {
    const nodes = new Map();
    for (const chunk of chunks) {
        if (!chunk.pageTarget.startsWith('concepts/')) {
            continue;
        }
        const slug = chunk.pageTarget.slice('concepts/'.length);
        const node = nodes.get(slug) ?? {
            slug,
            name: chunk.pageTitle,
            aliases: [],
            redirectsFrom: [],
            relatedSlugs: [],
            chunkIds: [],
            pageTargets: [],
            sourceRefs: [],
        };
        node.chunkIds.push(chunk.chunkId);
        if (!node.pageTargets.includes(chunk.pageTarget)) {
            node.pageTargets.push(chunk.pageTarget);
        }
        if (chunk.sourceRef && !node.sourceRefs.includes(chunk.sourceRef)) {
            node.sourceRefs.push(chunk.sourceRef);
        }
        nodes.set(slug, node);
    }
    for (const [alias, target] of Object.entries(metadata.aliases)) {
        const node = nodes.get(target);
        if (node && !node.aliases.includes(alias)) {
            node.aliases.push(alias);
        }
    }
    for (const [from, to] of Object.entries(metadata.redirects)) {
        const node = nodes.get(to);
        if (node && !node.redirectsFrom.includes(from)) {
            node.redirectsFrom.push(from);
        }
    }
    for (const edge of metadata.categoryEdges) {
        if (edge.status !== undefined && edge.status !== 'accepted') {
            continue;
        }
        const fromNode = nodes.get(edge.from);
        const toNode = nodes.get(edge.to);
        if (fromNode && !fromNode.relatedSlugs.includes(edge.to)) {
            fromNode.relatedSlugs.push(edge.to);
        }
        if (toNode && !toNode.relatedSlugs.includes(edge.from)) {
            toNode.relatedSlugs.push(edge.from);
        }
    }
    return [...nodes.values()]
        .map((node) => ({
        ...node,
        aliases: [...new Set(node.aliases)].sort((left, right) => left.localeCompare(right)),
        redirectsFrom: [...new Set(node.redirectsFrom)].sort((left, right) => left.localeCompare(right)),
        relatedSlugs: [...new Set(node.relatedSlugs)].sort((left, right) => left.localeCompare(right)),
        chunkIds: [...new Set(node.chunkIds)].sort((left, right) => left.localeCompare(right)),
        pageTargets: [...new Set(node.pageTargets)].sort((left, right) => left.localeCompare(right)),
        sourceRefs: [...new Set(node.sourceRefs)].sort((left, right) => left.localeCompare(right)),
    }))
        .sort((left, right) => left.slug.localeCompare(right.slug));
}
async function resolvePageEvidenceSource(input) {
    const sourceRef = extractSourceRef(input.pageContent);
    const artifactId = extractArtifactId(input.pageContent);
    const privacyMetadata = extractPrivacyMetadata(input.pageContent);
    if (input.page.section === 'sources' && sourceRef) {
        const rawEntry = findRawManifestEntry(input.rawManifest, sourceRef);
        if (rawEntry) {
            const rawPath = path.join(input.root, rawEntry.relativePath);
            try {
                const rawContent = await readFile(rawPath, 'utf8');
                const body = stripManagedRawFrontmatter(rawContent).trim();
                if (body) {
                    return {
                        content: body,
                        filePath: rawPath,
                        rawPath,
                        sourceRef,
                        artifactId,
                        sourceKind: rawEntry.sourceKind,
                        evidenceKind: 'raw',
                        contentHash: hashText(`${rawEntry.sha256}\n${body}`),
                        privacyMetadata,
                    };
                }
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }
    }
    return {
        content: input.pageContent,
        filePath: input.page.filePath,
        rawPath: null,
        sourceRef,
        artifactId,
        sourceKind: null,
        evidenceKind: 'wiki',
        contentHash: hashText(input.pageContent),
        privacyMetadata,
    };
}
function findRawManifestEntry(manifest, sourceRef) {
    const candidates = Object.values(manifest.entries)
        .filter((entry) => entry.sourceRef === sourceRef && entry.state !== 'rejected')
        .sort((left, right) => rawManifestCapturedAt(right).localeCompare(rawManifestCapturedAt(left))
        || rawManifestStateRank(right.state) - rawManifestStateRank(left.state)
        || right.relativePath.localeCompare(left.relativePath));
    return candidates[0] ?? null;
}
function rawManifestCapturedAt(entry) {
    return entry.capturedAt ?? entry.archivedAt ?? '';
}
function rawManifestStateRank(state) {
    if (state === 'archived')
        return 3;
    if (state === 'staged')
        return 2;
    return 1;
}
async function buildReviewProposalChunks(root) {
    const directories = [
        { directory: path.join(root, 'review', 'queue'), targetPrefix: 'review/queue', titlePrefix: 'Review proposal' },
        { directory: path.join(root, 'review', 'low-confidence'), targetPrefix: 'review/low-confidence', titlePrefix: 'Low-confidence review proposal' },
        { directory: path.join(root, 'review', 'conflicts'), targetPrefix: 'review/conflicts', titlePrefix: 'Conflict review proposal' },
        { directory: path.join(root, 'taxonomy', 'proposals'), targetPrefix: 'taxonomy/proposals', titlePrefix: 'Taxonomy proposal' },
        { directory: path.join(root, 'taxonomy', 'evidence-proposals'), targetPrefix: 'taxonomy/evidence-proposals', titlePrefix: 'Taxonomy evidence proposal' },
    ];
    const chunks = [];
    for (const entry of directories) {
        let files = [];
        try {
            files = (await readdir(entry.directory, { withFileTypes: true }))
                .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.json'))
                .map((dirent) => dirent.name)
                .sort((left, right) => left.localeCompare(right));
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            continue;
        }
        for (const fileName of files) {
            const filePath = path.join(entry.directory, fileName);
            const slug = fileName.replace(/\.json$/i, '');
            const raw = await readFile(filePath, 'utf8');
            const parsed = await readJsonFile(filePath, {});
            const title = typeof parsed.title === 'string'
                ? parsed.title
                : typeof parsed.name === 'string'
                    ? parsed.name
                    : `${entry.titlePrefix}: ${slug}`;
            const text = reviewProposalText(title, parsed, raw);
            const pageTarget = `${entry.targetPrefix}/${slug}`;
            const textSha256 = createHash('sha256').update(text).digest('hex');
            const chunkId = `sha256:${createHash('sha256').update(`${pageTarget}\n${textSha256}`).digest('hex')}`;
            chunks.push({
                version: 2,
                id: `review:${pageTarget}`,
                chunkId,
                pageTarget,
                pageTitle: title,
                filePath,
                sourceRef: null,
                heading: entry.titlePrefix,
                headingPath: [entry.titlePrefix],
                level: 1,
                startLine: 1,
                endLine: raw.split('\n').length,
                anchor: slug,
                text,
                textSha256,
                tokenCountApprox: approximateTokenCount(text),
                links: [],
                metadata: {
                    docType: 'review-proposal',
                    section: 'queries',
                    slug: pageTarget,
                },
            });
        }
    }
    return chunks;
}
function reviewProposalText(title, parsed, raw) {
    const fields = [
        title,
        stringField(parsed, 'status'),
        stringField(parsed, 'kind'),
        stringField(parsed, 'rationale'),
        stringField(parsed, 'reason'),
        arrayField(parsed, 'evidence'),
        arrayField(parsed, 'risks'),
        arrayField(parsed, 'reviewQuestions'),
        arrayField(parsed, 'humanQuestions'),
        arrayField(parsed, 'aliases'),
        arrayField(parsed, 'sources'),
    ].filter(Boolean);
    return fields.length > 1 ? fields.join('\n') : raw;
}
function stringField(record, key) {
    const value = record[key];
    return typeof value === 'string' ? value : '';
}
function arrayField(record, key) {
    const value = record[key];
    if (!Array.isArray(value))
        return '';
    return value.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n');
}
function extractSourceRef(content) {
    const match = content.match(/^\s*-\s*(?:Source ref|来源引用):\s*(.+)$/m);
    return match?.[1]?.trim() || null;
}
function extractArtifactId(content) {
    const bodyMatch = content.match(/^\s*-\s*(?:Artifact ID|资料 ID):\s*(.+)$/m);
    if (bodyMatch?.[1]?.trim()) {
        return bodyMatch[1].trim();
    }
    const frontmatter = parseSimpleFrontmatter(content);
    const sources = frontmatter.sources?.trim();
    if (!sources) {
        return null;
    }
    try {
        const parsed = JSON.parse(sources);
        if (Array.isArray(parsed)) {
            const first = parsed.find((item) => typeof item === 'string' && item.trim().length > 0);
            return typeof first === 'string' ? first.trim() : null;
        }
        return typeof parsed === 'string' && parsed.trim().length > 0 ? parsed.trim() : null;
    }
    catch {
        return sources || null;
    }
}
function parseSimpleFrontmatter(content) {
    if (!content.startsWith('---\n')) {
        return {};
    }
    const closingIndex = content.indexOf('\n---\n', 4);
    if (closingIndex === -1) {
        return {};
    }
    const result = {};
    for (const line of content.slice(4, closingIndex).split('\n')) {
        const separator = line.indexOf(':');
        if (separator <= 0)
            continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
        result[key] = value;
    }
    return result;
}
