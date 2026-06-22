import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { contentDedupIndexPath, contentHashForDedup, createContentDedupStore } from './content-dedup-store.js';
import { createDedupStore } from './dedup-store.js';
import { loadContentDedupEmbedding } from './content-dedup-embedding.js';
import { backfillDedupManifestPageSnapshots } from './manifest-migration.js';
import { readRawManifest, stripManagedRawFrontmatter } from './raw-store.js';
export async function backfillContentDedupIndex(input) {
    const knowledgeRoot = path.resolve(input.knowledgeRoot);
    const sourceDedupManifestPath = path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json');
    const sourceManifest = await backfillDedupManifestPageSnapshots({
        knowledgeRoot,
        manifestPath: sourceDedupManifestPath,
    });
    const sourceDedup = createDedupStore(sourceDedupManifestPath);
    const contentDedup = createContentDedupStore(contentDedupIndexPath(knowledgeRoot));
    const entries = await sourceDedup.list();
    const rawManifest = await readRawManifest(knowledgeRoot);
    const chunkCounts = await loadSourceChunkCounts(knowledgeRoot);
    const existingRecords = await contentDedup.listRecords();
    const existingByDocHash = new Map(existingRecords.map((record) => [record.docHash, record]));
    const results = [];
    for (const entry of entries) {
        const candidate = await loadSourcePageCandidate(knowledgeRoot, entry, rawManifest.entries);
        if (!candidate) {
            results.push({
                sourceIdentity: entry.identity,
                pageId: null,
                title: null,
                status: 'skipped',
                reason: 'no-source-page',
            });
            continue;
        }
        const content = candidate.content.trim();
        if (!content) {
            results.push({
                sourceIdentity: entry.identity,
                pageId: candidate.pageId,
                title: candidate.title,
                status: 'skipped',
                reason: 'no-content',
            });
            continue;
        }
        const docHash = contentHashForDedup(content);
        const existing = existingByDocHash.get(docHash);
        if (existing?.sourceIdentity === entry.identity && existing.pageId === candidate.pageId) {
            results.push({
                sourceIdentity: entry.identity,
                pageId: candidate.pageId,
                title: candidate.title,
                status: 'skipped',
                reason: 'already-current',
                docHash,
                chunkCount: existing.chunkCount,
                ...(existing.embeddingProvider ? { embeddingProvider: existing.embeddingProvider } : {}),
                ...(existing.embeddingModel ? { embeddingModel: existing.embeddingModel } : {}),
            });
            continue;
        }
        if (existing && existing.sourceIdentity !== entry.identity) {
            results.push({
                sourceIdentity: entry.identity,
                pageId: candidate.pageId,
                title: candidate.title,
                status: 'skipped',
                reason: 'duplicate-doc-hash',
                docHash,
                chunkCount: chunkCounts.get(candidate.pageId) ?? 0,
                ...(existing.embeddingProvider ? { embeddingProvider: existing.embeddingProvider } : {}),
                ...(existing.embeddingModel ? { embeddingModel: existing.embeddingModel } : {}),
            });
            continue;
        }
        const embedding = await loadContentDedupEmbedding(content);
        const record = await contentDedup.recordDocument({
            docHash,
            sourceIdentity: entry.identity,
            sourceKind: normalizeBackfillSourceKind(entry.sourceKind),
            sourceUrl: entry.sourceKind === 'url' ? entry.identity : null,
            title: candidate.title,
            pageId: candidate.pageId,
            chunkCount: chunkCounts.get(candidate.pageId) ?? 0,
            embeddingProvider: embedding.provider,
            embeddingModel: embedding.model,
            embeddingVector: embedding.vector,
            now: entry.lastCompiledAt ?? undefined,
        });
        existingByDocHash.set(docHash, record);
        results.push({
            sourceIdentity: entry.identity,
            pageId: candidate.pageId,
            title: candidate.title,
            status: 'recorded',
            docHash,
            chunkCount: record.chunkCount,
            ...(embedding.provider ? { embeddingProvider: embedding.provider } : {}),
            ...(embedding.model ? { embeddingModel: embedding.model } : {}),
            ...(embedding.diagnostic ? { embeddingDiagnostic: embedding.diagnostic } : {}),
        });
    }
    return {
        knowledgeRoot,
        sourceManifest,
        inspected: entries.length,
        recorded: results.filter((result) => result.status === 'recorded').length,
        skipped: results.filter((result) => result.status === 'skipped').length,
        embedded: results.filter((result) => result.status === 'recorded' && result.embeddingProvider && !result.embeddingDiagnostic).length,
        embeddingFailures: results.filter((result) => result.status === 'recorded' && Boolean(result.embeddingDiagnostic)).length,
        records: results,
    };
}
async function loadSourcePageCandidate(knowledgeRoot, entry, rawEntries) {
    const sourcePage = resolveSourcePage(entry);
    if (!sourcePage) {
        return null;
    }
    const title = sourcePage.title ?? await readMarkdownTitle(path.join(knowledgeRoot, sourcePage.relativePath)) ?? sourcePage.pageId;
    const rawContent = await readBestRawContent(knowledgeRoot, entry.identity, rawEntries);
    if (rawContent !== null) {
        return { pageId: sourcePage.pageId, title, content: rawContent };
    }
    const snapshot = entry.lastOutputManifest?.pageSnapshots?.find((item) => normalizeRelativePath(item.filePath) === sourcePage.relativePath);
    if (snapshot?.body) {
        return { pageId: sourcePage.pageId, title: snapshot.title || title, content: snapshot.body };
    }
    try {
        return { pageId: sourcePage.pageId, title, content: await readFile(path.join(knowledgeRoot, sourcePage.relativePath), 'utf8') };
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function resolveSourcePage(entry) {
    const manifest = entry.lastOutputManifest;
    const pageFile = manifest?.pageFiles
        .map(normalizeRelativePath)
        .find((file) => /^wiki\/sources\/[^/]+\.md$/.test(file));
    if (!pageFile) {
        return null;
    }
    const snapshot = manifest?.pageSnapshots?.find((item) => normalizeRelativePath(item.filePath) === pageFile);
    return {
        pageId: pageFile.replace(/^wiki\//, '').replace(/\.md$/, ''),
        relativePath: pageFile,
        ...(snapshot?.title ? { title: snapshot.title } : {}),
    };
}
async function readBestRawContent(knowledgeRoot, sourceIdentity, rawEntries) {
    const rawEntry = Object.values(rawEntries)
        .filter((entry) => entry.sourceRef === sourceIdentity && entry.state !== 'rejected')
        .sort((left, right) => rawEntryTime(right).localeCompare(rawEntryTime(left)))[0];
    const candidatePaths = [
        rawEntry ? path.join(knowledgeRoot, rawEntry.relativePath) : null,
        path.isAbsolute(sourceIdentity) ? sourceIdentity : null,
    ].filter((value) => Boolean(value));
    for (const candidatePath of candidatePaths) {
        try {
            const raw = await readFile(candidatePath, 'utf8');
            return stripManagedRawFrontmatter(raw);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return null;
}
async function loadSourceChunkCounts(knowledgeRoot) {
    try {
        const raw = await readFile(path.join(knowledgeRoot, 'system', 'index', 'chunks.json'), 'utf8');
        const parsed = JSON.parse(raw);
        const result = new Map();
        for (const chunk of parsed.chunks ?? []) {
            if (chunk.metadata?.section !== 'sources') {
                continue;
            }
            result.set(chunk.pageTarget, (result.get(chunk.pageTarget) ?? 0) + 1);
        }
        return result;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return new Map();
        }
        throw error;
    }
}
async function readMarkdownTitle(filePath) {
    try {
        const raw = await readFile(filePath, 'utf8');
        const title = raw.split(/\r?\n/).find((line) => line.startsWith('# '));
        return title ? title.replace(/^#\s+/, '').trim() : null;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function normalizeRelativePath(value) {
    return value.split(path.sep).join('/');
}
function rawEntryTime(entry) {
    return entry.archivedAt ?? entry.capturedAt ?? '';
}
function normalizeBackfillSourceKind(value) {
    return value === 'md' || value === 'txt' || value === 'url' || value === 'repo' ? value : 'md';
}
