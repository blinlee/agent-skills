import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { embeddingCacheDirectory } from './embedding-cache.js';
export function embeddingModelMetaPath(knowledgeRoot, config) {
    return path.join(embeddingCacheDirectory(knowledgeRoot, config), 'model_meta.json');
}
export async function writeEmbeddingModelMeta(knowledgeRoot, config, input) {
    const meta = {
        version: 1,
        schema: 'llm-wiki.embedding-model-meta.v1',
        provider: config.provider,
        model: config.model,
        dims: input.dims,
        updatedAt: input.updatedAt,
    };
    await writeFile(embeddingModelMetaPath(knowledgeRoot, config), JSON.stringify(meta, null, 2) + '\n', 'utf8');
}
export async function readEmbeddingModelMeta(knowledgeRoot, config) {
    return readEmbeddingModelMetaFile(embeddingModelMetaPath(knowledgeRoot, config));
}
export async function embeddingModelMetaDiagnostics(knowledgeRoot, config) {
    const diagnostics = [];
    const current = await readEmbeddingModelMeta(knowledgeRoot, config);
    if (current) {
        return diagnoseMeta(current, config);
    }
    const known = await listEmbeddingModelMetas(knowledgeRoot);
    for (const meta of known) {
        if (meta.provider === config.provider && meta.model === config.model) {
            continue;
        }
        diagnostics.push(`embedding model meta mismatch: current ${config.provider}:${config.model}; existing cache uses ${meta.provider}:${meta.model} (${meta.dims} dims). Run llm-wiki embed-index ${knowledgeRoot} to build embeddings for the current provider/model.`);
    }
    return [...new Set(diagnostics)];
}
export async function embeddingQueryVectorDimensionDiagnostics(knowledgeRoot, config, input) {
    const expectedDims = await readCurrentEmbeddingDims(knowledgeRoot, config, input.records);
    if (expectedDims === null || expectedDims === input.queryVectorDims) {
        return [];
    }
    return [
        `embedding dimension meta mismatch: query vector has ${input.queryVectorDims} dims; cache records ${expectedDims} dims for ${config.provider}:${config.model}. Run llm-wiki embed-index to rebuild the embedding cache.`,
    ];
}
async function listEmbeddingModelMetas(knowledgeRoot) {
    const embeddingsDir = path.join(path.resolve(knowledgeRoot), 'system', 'index', 'embeddings');
    let entries;
    try {
        entries = await readdir(embeddingsDir);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
    const metas = await Promise.all(entries.map((entry) => readEmbeddingModelMetaFile(path.join(embeddingsDir, entry, 'model_meta.json'))));
    return metas.filter((meta) => meta !== null);
}
async function readEmbeddingModelMetaFile(filePath) {
    try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8'));
        return isEmbeddingModelMeta(parsed) ? parsed : null;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
function diagnoseMeta(meta, config) {
    const diagnostics = [];
    if (meta.provider !== config.provider || meta.model !== config.model) {
        diagnostics.push(`embedding model meta mismatch: current ${config.provider}:${config.model}; cache was built with ${meta.provider}:${meta.model} (${meta.dims} dims). Run llm-wiki embed-index to rebuild the embedding cache.`);
    }
    if (typeof config.dimensions === 'number' && meta.dims !== config.dimensions) {
        diagnostics.push(`embedding dimension meta mismatch: current config expects ${config.dimensions} dims; cache records ${meta.dims} dims for ${meta.provider}:${meta.model}. Run llm-wiki embed-index to rebuild the embedding cache.`);
    }
    return diagnostics;
}
async function readCurrentEmbeddingDims(knowledgeRoot, config, records) {
    const meta = await readEmbeddingModelMeta(knowledgeRoot, config);
    if (meta) {
        return meta.dims;
    }
    const record = records.find((candidate) => candidate.provider === config.provider && candidate.model === config.model);
    return record?.dims ?? null;
}
function isEmbeddingModelMeta(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const candidate = value;
    const dims = candidate.dims;
    return candidate.version === 1
        && candidate.schema === 'llm-wiki.embedding-model-meta.v1'
        && isProvider(candidate.provider)
        && typeof candidate.model === 'string'
        && candidate.model.length > 0
        && typeof dims === 'number'
        && Number.isInteger(dims)
        && dims > 0
        && typeof candidate.updatedAt === 'string';
}
function isProvider(value) {
    return value === 'local-http' || value === 'ollama' || value === 'lm-studio' || value === 'custom-endpoint';
}
