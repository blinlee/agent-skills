import { embeddingCacheKey } from './embedding-cache.js';
const LEXICAL_WEIGHT = 1;
const EMBEDDING_WEIGHT = 0.35;
const EMBEDDING_ONLY_CAP = 0.2;
const SOURCE_METADATA_BOOST = 0.05;
const SOURCE_CARD_BOILERPLATE_PENALTY = 0.25;
const EMBEDDING_MIN_SIMILARITY = 0.15;
export function scoreHybrid(input) {
    const entries = [];
    const maxLexical = Math.max(0, ...[...input.lexicalScores.values()].map((entry) => entry.score));
    for (const chunk of input.chunks) {
        const lexicalRaw = input.lexicalScores.get(chunk.chunkId);
        const lexical = maxLexical > 0 && lexicalRaw ? lexicalRaw.score / maxLexical : 0;
        const metadata = metadataScoreForChunk(chunk, lexical > 0);
        const graphBoost = input.graphBoosts?.get(chunk.chunkId);
        const graph = graphBoost?.score ?? 0;
        const taxonomyBoost = input.taxonomyBoosts?.get(chunk.chunkId);
        const taxonomy = taxonomyBoost?.score ?? 0;
        const embedding = embeddingScoreForChunk({
            chunk,
            queryVector: input.queryVector,
            embeddingRecords: input.embeddingRecords,
            providerConfig: input.providerConfig,
        });
        if (lexical <= 0 && embedding <= 0 && graph <= 0 && taxonomy <= 0 && metadata <= 0) {
            continue;
        }
        const weightedEmbedding = embedding * EMBEDDING_WEIGHT;
        const cappedEmbedding = lexical > 0 ? weightedEmbedding : Math.min(weightedEmbedding, EMBEDDING_ONLY_CAP);
        const total = (lexical * LEXICAL_WEIGHT) + cappedEmbedding + graph + taxonomy + metadata;
        const terms = lexicalRaw?.terms ?? [];
        const reasons = [
            ...[...new Set(terms)].sort().map((term) => `term:${term}`),
            ...(embedding > 0 ? [`embedding:cosine:${embedding.toFixed(3)}`] : []),
            ...(lexical <= 0 && embedding > 0 ? ['diagnostic:embedding-only'] : []),
            ...(graphBoost?.reasons ?? []),
            ...(taxonomyBoost?.reasons ?? []),
            ...(lexical > 0 && chunk.metadata.section === 'sources' ? ['metadata:source'] : []),
            ...(metadata < 0 ? ['metadata:source-card-boilerplate-penalty'] : []),
        ];
        entries.push({
            chunk,
            lexical: round(lexical),
            embedding: round(embedding),
            graph: round(graph),
            taxonomy: round(taxonomy),
            metadata: round(metadata),
            total: round(total),
            lexicalTerms: terms,
            reasons,
        });
    }
    return entries.sort((left, right) => right.total - left.total
        || right.lexical - left.lexical
        || left.chunk.chunkId.localeCompare(right.chunk.chunkId));
}
function metadataScoreForChunk(chunk, hasLexicalMatch) {
    if (!hasLexicalMatch || chunk.metadata.section !== 'sources') {
        return 0;
    }
    return SOURCE_METADATA_BOOST - sourceCardBoilerplatePenalty(chunk);
}
function sourceCardBoilerplatePenalty(chunk) {
    const heading = chunk.heading.trim().toLowerCase();
    const text = chunk.text.toLowerCase();
    if (heading === '证据说明' || heading === 'evidence note' || heading === 'related wiki pages') {
        return SOURCE_CARD_BOILERPLATE_PENALTY;
    }
    if (text.includes('资料 id:') || text.includes('来源类型:') || text.includes('source type:') || text.includes('source ref:')) {
        return SOURCE_CARD_BOILERPLATE_PENALTY;
    }
    return 0;
}
function embeddingScoreForChunk(input) {
    if (!input.queryVector || !input.providerConfig) {
        return 0;
    }
    const cacheKey = embeddingCacheKey({
        provider: input.providerConfig.provider,
        model: input.providerConfig.model,
        textSha256: input.chunk.textSha256,
    });
    const record = input.embeddingRecords.get(cacheKey);
    if (!record) {
        return 0;
    }
    const cosine = cosineSimilarity(input.queryVector, record.vector);
    return cosine >= EMBEDDING_MIN_SIMILARITY ? Math.max(0, cosine) : 0;
}
function cosineSimilarity(left, right) {
    if (left.length !== right.length || left.length === 0) {
        return 0;
    }
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftNorm += left[index] ** 2;
        rightNorm += right[index] ** 2;
    }
    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
function round(value) {
    return Number(value.toFixed(6));
}
