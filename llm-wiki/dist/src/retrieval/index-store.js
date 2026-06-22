import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashRawBody, readRawManifest, stripManagedRawFrontmatter } from '../intake/raw-store.js';
export async function loadRetrievalIndex(knowledgeRoot) {
    const root = path.resolve(knowledgeRoot);
    try {
        const [chunksRaw, lexicalRaw, linksRaw, topicNodesRaw, entityGraphRaw, topicsRaw, aliasesRaw, redirectsRaw, categoryGraphRaw] = await Promise.all([
            readFile(path.join(root, 'system', 'index', 'chunks.json'), 'utf8'),
            readFile(path.join(root, 'system', 'index', 'lexical.json'), 'utf8'),
            readOptionalFile(path.join(root, 'system', 'index', 'links.json')),
            readOptionalFile(path.join(root, 'system', 'index', 'topics.json')),
            readOptionalFile(path.join(root, 'system', 'index', 'entity-graph.json')),
            readOptionalFile(path.join(root, 'taxonomy', 'topic-registry.json')),
            readOptionalFile(path.join(root, 'taxonomy', 'aliases.json')),
            readOptionalFile(path.join(root, 'taxonomy', 'redirects.json')),
            readOptionalFile(path.join(root, 'taxonomy', 'category-graph.json')),
        ]);
        const chunkState = JSON.parse(chunksRaw);
        const lexical = JSON.parse(lexicalRaw);
        if (chunkState.version !== 2 || chunkState.schema !== 'llm-wiki.chunks.v2' || !Array.isArray(chunkState.chunks)) {
            return null;
        }
        if (lexical.version !== 1 || lexical.schema !== 'llm-wiki.lexical.v1' || lexical.chunkIndexVersion !== 2 || !lexical.terms) {
            return null;
        }
        const chunks = chunkState.chunks;
        const readinessDiagnostics = await rawBackedReadinessDiagnostics(root, chunks);
        return {
            chunks,
            chunksById: new Map(chunks.map((chunk) => [chunk.chunkId, chunk])),
            lexical: lexical,
            graph: parseGraphIndex(linksRaw),
            entityGraph: parseEntityGraphIndex(entityGraphRaw),
            taxonomy: parseTaxonomyIndex(topicNodesRaw, topicsRaw, aliasesRaw, redirectsRaw, categoryGraphRaw),
            readinessDiagnostics,
        };
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
async function rawBackedReadinessDiagnostics(root, chunks) {
    const manifest = await readRawManifest(root);
    const diagnostics = [];
    const checkedRawPaths = new Set();
    for (const chunk of chunks) {
        if (chunk.metadata.section !== 'sources' || !chunk.sourceRef) {
            continue;
        }
        const manifestEntry = findManifestEntry(manifest, chunk.sourceRef, chunk.rawPath ? normalizeRelativePath(path.relative(root, chunk.rawPath)) : null);
        if (!manifestEntry) {
            continue;
        }
        if (!chunk.rawPath) {
            diagnostics.push(`stale-index: source ${chunk.pageTarget} has managed raw evidence for ${chunk.sourceRef} but chunk index is wiki-derived; rebuild index`);
            continue;
        }
        const rawPath = path.resolve(chunk.rawPath);
        if (checkedRawPaths.has(rawPath)) {
            continue;
        }
        checkedRawPaths.add(rawPath);
        try {
            const rawContent = await readFile(rawPath, 'utf8');
            const bodyHash = hashRawBody(stripManagedRawFrontmatter(rawContent));
            if (manifestEntry.sha256 && bodyHash !== manifestEntry.sha256) {
                diagnostics.push(`stale-index: raw source drift detected for ${manifestEntry.relativePath}; rebuild index after restoring or recapturing raw`);
            }
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                diagnostics.push(`stale-index: indexed raw source missing at ${manifestEntry.relativePath}; rebuild index after restoring raw`);
                continue;
            }
            throw error;
        }
    }
    return [...new Set(diagnostics)];
}
function findManifestEntry(manifest, sourceRef, relativeRawPath) {
    if (relativeRawPath && manifest.entries[relativeRawPath]) {
        return manifest.entries[relativeRawPath];
    }
    const candidates = Object.values(manifest.entries)
        .filter((entry) => entry.sourceRef === sourceRef && entry.state !== 'rejected')
        .sort((left, right) => (right.capturedAt ?? right.archivedAt ?? '').localeCompare(left.capturedAt ?? left.archivedAt ?? ''));
    return candidates[0] ?? null;
}
function normalizeRelativePath(value) {
    return value.split(path.sep).join('/');
}
async function readOptionalFile(filePath) {
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
function parseGraphIndex(raw) {
    if (!raw) {
        return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || !Array.isArray(parsed.links) || !parsed.backlinks || typeof parsed.backlinks !== 'object') {
        return null;
    }
    return {
        links: parsed.links.filter((link) => typeof link.from === 'string' && (typeof link.to === 'string' || link.to === null)),
        backlinks: parsed.backlinks,
    };
}
function parseEntityGraphIndex(raw) {
    if (!raw)
        return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || parsed.schema !== 'llm-wiki.entity-concept-graph.v1' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        return null;
    }
    return parsed;
}
function parseTaxonomyIndex(topicNodesRaw, topicsRaw, aliasesRaw, redirectsRaw, categoryGraphRaw) {
    const topicNodes = parseTopicNodes(topicNodesRaw);
    const topics = parseTopics(topicsRaw);
    const aliases = parseStringRecord(aliasesRaw, 'aliases');
    const redirects = parseStringRecord(redirectsRaw, 'redirects');
    const categoryEdges = parseCategoryEdges(categoryGraphRaw);
    if (topics.length === 0 && topicNodes.length === 0 && Object.keys(aliases).length === 0 && Object.keys(redirects).length === 0 && categoryEdges.length === 0) {
        return null;
    }
    return { topics, topicNodes, aliases, redirects, categoryEdges };
}
function parseTopicNodes(raw) {
    if (!raw) {
        return [];
    }
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || parsed.schema !== 'llm-wiki.topics.v1' || !Array.isArray(parsed.topics)) {
        return [];
    }
    return parsed.topics.flatMap((topic) => {
        if (!topic || typeof topic !== 'object') {
            return [];
        }
        const record = topic;
        if (typeof record.slug !== 'string' || typeof record.name !== 'string' || !Array.isArray(record.chunkIds)) {
            return [];
        }
        return [{
                slug: record.slug,
                name: record.name,
                aliases: stringArray(record.aliases),
                redirectsFrom: stringArray(record.redirectsFrom),
                relatedSlugs: stringArray(record.relatedSlugs),
                chunkIds: stringArray(record.chunkIds),
                pageTargets: stringArray(record.pageTargets),
                sourceRefs: stringArray(record.sourceRefs),
            }];
    });
}
function parseTopics(raw) {
    if (!raw) {
        return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.topics)) {
        return [];
    }
    return parsed.topics.flatMap((topic) => {
        if (!topic || typeof topic !== 'object') {
            return [];
        }
        const record = topic;
        if (typeof record.slug !== 'string' || typeof record.name !== 'string') {
            return [];
        }
        return [{ slug: record.slug, name: record.name }];
    });
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
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
        if (record.status !== undefined && record.status !== 'accepted') {
            return [];
        }
        return [{
                from: record.from,
                to: record.to,
                type: typeof record.type === 'string' ? record.type : undefined,
            }];
    });
}
