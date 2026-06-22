import { tokenize } from './tokenize.js';
const STOP_WORDS = new Set([
    'about', 'after', 'also', 'and', 'are', 'based', 'been', 'before', 'between', 'chunk', 'content', 'data', 'default', 'does', 'evidence', 'from', 'have', 'into', 'more', 'not', 'page', 'query', 'retrieval', 'section', 'should', 'source', 'that', 'the', 'this', 'with', 'without',
    '一个', '不是', '以及', '可以', '当前', '证据', '来源', '问题', '需要',
]);
const MAX_TERMS_PER_CHUNK = 8;
const MAX_SEED_NODES = 6;
const MAX_HOPS = 2;
const MAX_FRONTIER = 18;
const DIRECT_BOOST = 0.07;
const SECOND_HOP_BOOST = 0.02;
const MAX_ENTITY_GRAPH_BOOST = 0.14;
export function buildEntityConceptGraphIndex(input) {
    const nodeMap = new Map();
    const edgeMap = new Map();
    const firstChunkByPage = new Map();
    const chunksByPage = new Map();
    for (const chunk of input.chunks) {
        if (!firstChunkByPage.has(chunk.pageTarget)) {
            firstChunkByPage.set(chunk.pageTarget, chunk.chunkId);
        }
        chunksByPage.set(chunk.pageTarget, [...(chunksByPage.get(chunk.pageTarget) ?? []), chunk.chunkId]);
    }
    const ambiguousSlugs = findAmbiguousSlugs(input.chunks);
    for (const chunk of input.chunks) {
        if (ambiguousSlugs.has(chunk.metadata.slug))
            continue;
        const candidates = extractChunkConcepts(chunk);
        for (const candidate of candidates) {
            const node = getOrCreateNode(nodeMap, candidate.id, candidate.kind, candidate.label, candidate.normalized);
            addUnique(node.chunkIds, chunk.chunkId);
            addUnique(node.pageTargets, chunk.pageTarget);
            node.weight += candidate.weight;
        }
        for (let i = 0; i < candidates.length; i += 1) {
            for (let j = i + 1; j < candidates.length; j += 1) {
                addEdge(edgeMap, candidates[i].id, candidates[j].id, 'cooccurs', 1, {
                    chunkIds: [chunk.chunkId],
                    pageTargets: [chunk.pageTarget],
                    routingOnly: false,
                    reason: 'same-chunk-concept-cooccurrence',
                });
            }
        }
    }
    const nodesByPage = new Map();
    for (const node of nodeMap.values()) {
        for (const pageTarget of node.pageTargets) {
            nodesByPage.set(pageTarget, [...(nodesByPage.get(pageTarget) ?? []), node.id]);
        }
    }
    for (const link of input.pageLinks ?? []) {
        if (link.status !== 'resolved' || !link.to)
            continue;
        const fromNodes = nodesByPage.get(link.from) ?? [];
        const toNodes = nodesByPage.get(link.to) ?? [];
        const provenanceChunks = uniqueStrings([...(chunksByPage.get(link.from) ?? []), ...(chunksByPage.get(link.to) ?? [])]);
        for (const from of fromNodes.slice(0, 5)) {
            for (const to of toNodes.slice(0, 5)) {
                if (from !== to)
                    addEdge(edgeMap, from, to, 'page-link', 0.75, {
                        chunkIds: provenanceChunks,
                        pageTargets: [link.from, link.to],
                        routingOnly: true,
                        reason: `wiki-link:${link.from}->${link.to}`,
                    });
            }
        }
    }
    for (const edge of input.topicEdges ?? []) {
        const from = conceptNodeId(edge.from);
        const to = conceptNodeId(edge.to);
        if (nodeMap.has(from) && nodeMap.has(to)) {
            const fromNode = nodeMap.get(from);
            const toNode = nodeMap.get(to);
            addEdge(edgeMap, from, to, 'topic-related', 0.6, {
                chunkIds: uniqueStrings([...fromNode.chunkIds, ...toNode.chunkIds]),
                pageTargets: uniqueStrings([...fromNode.pageTargets, ...toNode.pageTargets]),
                routingOnly: true,
                reason: `taxonomy-edge:${edge.type ?? 'related'}:${edge.from}->${edge.to}`,
            });
        }
    }
    for (const extraction of input.entityExtractions ?? []) {
        const chunkId = firstChunkByPage.get(extraction.pageTarget);
        if (!chunkId)
            continue;
        for (const entity of extraction.entities) {
            const id = entityNodeId(entity.name);
            const normalized = normalizeConcept(entity.name);
            if (!normalized)
                continue;
            const node = getOrCreateNode(nodeMap, id, 'entity', entity.name, normalized);
            addUnique(node.chunkIds, chunkId);
            addUnique(node.pageTargets, extraction.pageTarget);
            node.weight += 2;
        }
        for (const relationship of extraction.relationships) {
            const from = entityNodeId(relationship.source);
            const to = entityNodeId(relationship.target);
            if (nodeMap.has(from) && nodeMap.has(to)) {
                addEdge(edgeMap, from, to, 'llm-relation', 1.25, {
                    chunkIds: [chunkId],
                    pageTargets: [extraction.pageTarget],
                    routingOnly: false,
                    reason: `llm-entity-extraction:${extraction.pageTarget}`,
                });
            }
        }
    }
    const nodes = [...nodeMap.values()].map((node) => ({
        ...node,
        weight: Number(node.weight.toFixed(3)),
        chunkIds: node.chunkIds.sort(),
        pageTargets: node.pageTargets.sort(),
        aliases: [...new Set(node.aliases)].sort(),
    })).sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
    const validNodeIds = new Set(nodes.map((node) => node.id));
    const edges = [...edgeMap.values()]
        .filter((edge) => validNodeIds.has(edge.from) && validNodeIds.has(edge.to))
        .map((edge) => ({ ...edge, weight: Number(edge.weight.toFixed(3)), chunkIds: edge.chunkIds.sort(), pageTargets: edge.pageTargets.sort() }))
        .sort((left, right) => right.weight - left.weight || left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
    return {
        version: 1,
        schema: 'llm-wiki.entity-concept-graph.v1',
        knowledgeRoot: input.knowledgeRoot,
        generatedAt: input.generatedAt,
        nodes,
        edges,
    };
}
export function scoreEntityGraphBoosts(input) {
    if (!input.graph)
        return new Map();
    const nodesById = new Map(input.graph.nodes.map((node) => [node.id, node]));
    const edgesByNode = new Map();
    for (const edge of input.graph.edges) {
        edgesByNode.set(edge.from, [...(edgesByNode.get(edge.from) ?? []), edge]);
        edgesByNode.set(edge.to, [...(edgesByNode.get(edge.to) ?? []), { ...edge, from: edge.to, to: edge.from }]);
    }
    const queryTokenSet = new Set(input.queryTokens);
    const seedNodeIds = input.graph.nodes
        .map((node) => ({ node, score: seedScore(node, queryTokenSet, input.lexicalScores) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
        .slice(0, MAX_SEED_NODES)
        .map((entry) => entry.node.id);
    if (seedNodeIds.length === 0)
        return new Map();
    const chunkBoosts = new Map();
    const visited = new Set(seedNodeIds);
    let frontier = seedNodeIds.map((nodeId) => ({ nodeId, hop: 0, via: nodeId }));
    for (let hop = 1; hop <= MAX_HOPS; hop += 1) {
        const next = [];
        for (const item of frontier.slice(0, MAX_FRONTIER)) {
            const edges = (edgesByNode.get(item.nodeId) ?? [])
                .sort((left, right) => right.weight - left.weight)
                .slice(0, MAX_FRONTIER);
            for (const edge of edges) {
                const node = nodesById.get(edge.to);
                if (!node || visited.has(node.id))
                    continue;
                visited.add(node.id);
                next.push({ nodeId: node.id, hop, via: item.nodeId });
                const score = hop === 1 ? DIRECT_BOOST * edge.weight : SECOND_HOP_BOOST * edge.weight;
                for (const chunkId of node.chunkIds) {
                    if (input.lexicalScores.get(chunkId)?.score)
                        continue;
                    addChunkBoost(chunkBoosts, chunkId, score, `entity-graph:${hop}-hop:${edge.kind}:${item.nodeId}->${node.id}`);
                }
            }
        }
        frontier = next;
        if (frontier.length === 0)
            break;
    }
    for (const [chunkId, boost] of chunkBoosts.entries()) {
        boost.score = Number(Math.min(boost.score, MAX_ENTITY_GRAPH_BOOST).toFixed(6));
        boost.reasons = [...new Set(boost.reasons)].sort();
        if (boost.score <= 0)
            chunkBoosts.delete(chunkId);
    }
    return chunkBoosts;
}
function extractChunkConcepts(chunk) {
    const candidates = new Map();
    const add = (label, kind, weight) => {
        const normalized = normalizeConcept(label);
        if (!normalized || STOP_WORDS.has(normalized) || normalized.length < 3)
            return;
        const id = kind === 'topic' ? topicNodeId(normalized) : conceptNodeId(normalized);
        const current = candidates.get(id) ?? { id, kind, label: label.trim(), normalized, weight: 0 };
        current.weight += weight;
        candidates.set(id, current);
    };
    add(chunk.pageTitle, chunk.metadata.section === 'concepts' ? 'concept' : 'topic', 2.5);
    for (const heading of chunk.headingPath)
        add(heading, 'concept', 1.5);
    for (const link of chunk.links)
        add(link.split('#')[0], 'concept', 1.25);
    const text = chunk.text.replace(/`[^`]+`/g, ' ');
    for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[- ][A-Z][A-Za-z0-9]*){0,4}\b/g)) {
        add(match[0], 'entity', 1);
    }
    for (const token of tokenize(`${chunk.pageTitle} ${chunk.heading} ${text}`).filter((token) => token.length >= 4 && !STOP_WORDS.has(token))) {
        add(token, 'concept', 0.25);
    }
    return [...candidates.values()]
        .sort((left, right) => right.weight - left.weight || left.normalized.localeCompare(right.normalized))
        .slice(0, MAX_TERMS_PER_CHUNK);
}
function getOrCreateNode(nodes, id, kind, label, normalized) {
    const existing = nodes.get(id);
    if (existing) {
        if (existing.label !== label)
            addUnique(existing.aliases, label);
        return existing;
    }
    const node = { id, kind, label, normalized, chunkIds: [], pageTargets: [], aliases: [], weight: 0 };
    nodes.set(id, node);
    return node;
}
function addEdge(edges, left, right, kind, weight, provenance) {
    const [from, to] = left.localeCompare(right) <= 0 ? [left, right] : [right, left];
    if (from === to)
        return;
    const key = `${kind}:${from}->${to}`;
    const edge = edges.get(key) ?? {
        from,
        to,
        kind,
        weight: 0,
        chunkIds: [],
        pageTargets: [],
        routingOnly: provenance.routingOnly,
        reason: provenance.reason,
    };
    edge.weight += weight;
    edge.routingOnly = edge.routingOnly || provenance.routingOnly;
    for (const chunkId of provenance.chunkIds)
        addUnique(edge.chunkIds, chunkId);
    for (const pageTarget of provenance.pageTargets)
        addUnique(edge.pageTargets, pageTarget);
    edges.set(key, edge);
}
function seedScore(node, queryTokens, lexicalScores) {
    let score = 0;
    const nodeTokens = tokenize(`${node.label} ${node.normalized} ${node.aliases.join(' ')}`);
    const matchedQueryTokens = new Set(nodeTokens.filter((token) => queryTokens.has(token))).size;
    const lexicalSupport = node.chunkIds.reduce((total, chunkId) => total + Math.min(lexicalScores.get(chunkId)?.score ?? 0, 1), 0);
    if (matchedQueryTokens >= 2 || lexicalSupport > 0) {
        score += matchedQueryTokens * 2;
    }
    score += lexicalSupport;
    return score;
}
function addChunkBoost(boosts, chunkId, score, reason) {
    const current = boosts.get(chunkId) ?? { score: 0, reasons: [] };
    current.score += score;
    current.reasons.push(reason);
    boosts.set(chunkId, current);
}
function normalizeConcept(value) {
    return value
        .replace(/^concepts\//, '')
        .replace(/^sources\//, '')
        .replace(/[#_]/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
}
function conceptNodeId(value) {
    return `concept:${normalizeConcept(value)}`;
}
function entityNodeId(value) {
    return `entity:${normalizeConcept(value)}`;
}
function topicNodeId(value) {
    return `topic:${normalizeConcept(value)}`;
}
function addUnique(target, value) {
    if (value && !target.includes(value))
        target.push(value);
}
function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))].sort();
}
function findAmbiguousSlugs(chunks) {
    const sectionsBySlug = new Map();
    for (const chunk of chunks) {
        const sections = sectionsBySlug.get(chunk.metadata.slug) ?? new Set();
        sections.add(chunk.metadata.section);
        sectionsBySlug.set(chunk.metadata.slug, sections);
    }
    return new Set([...sectionsBySlug.entries()].filter(([, sections]) => sections.size > 1).map(([slug]) => slug));
}
