import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadKeyInfoIndex } from './key-info.js';
export async function buildLayeredContextPack(input) {
    const maxOverviewChars = input.maxOverviewChars ?? 1600;
    const [keyInfoIndex, wikiOverview, entityGraph] = await Promise.all([
        loadKeyInfoIndex(input.knowledgeRoot),
        loadWikiOverviewLayer(input.knowledgeRoot, input.citations, maxOverviewChars),
        loadEntityGraphContext(input.knowledgeRoot),
    ]);
    const keyInfo = selectKeyInfo(keyInfoIndex.records, input.citations);
    return {
        keyInfo: keyInfo.map((record) => ({
            target: record.pageTarget,
            title: record.title,
            chunkId: record.chunkId,
            summary: record.summary,
            keyClaims: record.keyClaims,
            methodology: record.methodology,
            evidence: record.evidence,
            limitations: record.limitations,
            relations: record.relations,
            openQuestions: record.openQuestions,
        })),
        wikiOverview,
        ragChunks: input.citations.map((citation, index) => ({
            citationIndex: index + 1,
            target: citation.target,
            title: citation.title,
            chunkId: citation.chunkId,
            filePath: citation.filePath,
            rawPath: citation.rawPath,
            evidenceKind: citation.evidenceKind,
            excerpt: citation.excerpt,
        })),
        graphContext: selectGraphContext(entityGraph, input.citations),
    };
}
function selectKeyInfo(records, citations) {
    const citedChunkIds = new Set(citations.flatMap((citation) => citation.chunkId ? [citation.chunkId] : []));
    const citedTargets = new Set(citations.map((citation) => citation.target));
    const selected = records.filter((record) => {
        if (record.chunkId && citedChunkIds.has(record.chunkId)) {
            return true;
        }
        return citedTargets.has(record.pageTarget);
    });
    return dedupeBy(selected, (record) => `${record.pageTarget}\n${record.chunkId ?? ''}`);
}
async function loadWikiOverviewLayer(knowledgeRoot, citations, maxOverviewChars) {
    const root = path.resolve(knowledgeRoot);
    const overviewFiles = [
        { source: 'wiki-overview', title: 'Wiki Overview', filePath: path.join(root, 'system', 'index', 'wiki-overview.md') },
        ...sectionIndexFiles(root, citations),
    ];
    const loaded = await Promise.all(overviewFiles.map(async (entry) => {
        const content = await readOptionalText(entry.filePath);
        if (!content) {
            return null;
        }
        return {
            source: entry.source,
            title: entry.title,
            filePath: entry.filePath,
            excerpt: compactExcerpt(content, maxOverviewChars),
        };
    }));
    return loaded.filter((entry) => entry !== null);
}
function sectionIndexFiles(root, citations) {
    const sections = dedupeBy(citations
        .map((citation) => citation.target.split('/')[0])
        .filter((section) => section && !section.includes('..')), (section) => section);
    return sections.map((section) => ({
        source: 'section-index',
        title: `${section} index`,
        filePath: path.join(root, 'wiki', section, 'index.md'),
    }));
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
async function loadEntityGraphContext(knowledgeRoot) {
    const raw = await readOptionalText(path.join(path.resolve(knowledgeRoot), 'system', 'index', 'entity-graph.json'));
    if (!raw) {
        return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || parsed.schema !== 'llm-wiki.entity-concept-graph.v1' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        return null;
    }
    return parsed;
}
function selectGraphContext(graph, citations) {
    if (!graph) {
        return [];
    }
    const citedChunkIds = new Set(citations.flatMap((citation) => citation.chunkId ? [citation.chunkId] : []));
    const citedTargets = new Set(citations.map((citation) => citation.target));
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const edgesByNode = new Map();
    for (const edge of graph.edges) {
        edgesByNode.set(edge.from, [...(edgesByNode.get(edge.from) ?? []), edge]);
        edgesByNode.set(edge.to, [...(edgesByNode.get(edge.to) ?? []), { ...edge, from: edge.to, to: edge.from }]);
    }
    return graph.nodes
        .filter((node) => node.chunkIds.some((chunkId) => citedChunkIds.has(chunkId)) || node.pageTargets.some((target) => citedTargets.has(target)))
        .map((node) => {
        const connectedNodes = (edgesByNode.get(node.id) ?? [])
            .map((edge) => ({ edge, node: nodesById.get(edge.to) }))
            .filter((entry) => Boolean(entry.node))
            .sort((left, right) => right.edge.weight - left.edge.weight || left.node.label.localeCompare(right.node.label))
            .slice(0, 6)
            .map(({ edge, node: connected }) => ({
            nodeId: connected.id,
            label: connected.label,
            kind: connected.kind,
            edgeKind: edge.kind,
            weight: edge.weight,
            chunkIds: edge.chunkIds,
            pageTargets: edge.pageTargets,
            routingOnly: edge.routingOnly,
            reason: edge.reason,
        }));
        const edgeScore = connectedNodes.reduce((total, edge) => total + edge.weight, 0);
        return {
            nodeId: node.id,
            label: node.label,
            kind: node.kind,
            score: Number((node.weight + edgeScore).toFixed(3)),
            pageTargets: node.pageTargets,
            chunkIds: node.chunkIds,
            connectedNodes,
        };
    })
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, 8);
}
function compactExcerpt(content, maxChars) {
    const compact = content.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) {
        return compact;
    }
    return `${compact.slice(0, Math.max(0, maxChars - 20)).trimEnd()} ...(truncated)`;
}
function dedupeBy(items, keyFor) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const key = keyFor(item);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
    }
    return result;
}
