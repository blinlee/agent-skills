import { runEmbedIndex } from '../retrieval/embed-index.js';
import { missingEmbeddingProviderMessage } from '../retrieval/embedding-provider.js';
export function summarizeIndexResult(result) {
    return {
        status: 'rebuilt',
        chunkCount: result.chunkCount,
        pageCount: result.pageCount,
    };
}
export function summarizeEmbeddingResult(result) {
    return {
        status: 'rebuilt',
        provider: result.provider,
        model: result.model,
        reusedCount: result.reusedCount,
        missingCount: result.missingCount,
        embeddedCount: result.embeddedCount,
        staleRemovedCount: result.staleRemovedCount,
        batchSize: result.batchSize,
        concurrency: result.concurrency,
        batchCount: result.batchCount,
        providerRequestCount: result.providerRequestCount,
        coverage: result.coverage,
    };
}
export async function runIngestEmbedIndex(knowledgeRoot) {
    try {
        return {
            result: await runEmbedIndex({ knowledgeRoot }),
            skippedReason: null,
        };
    }
    catch (error) {
        if (error instanceof Error && error.message === missingEmbeddingProviderMessage()) {
            return {
                result: null,
                skippedReason: missingEmbeddingProviderMessage(),
            };
        }
        throw error;
    }
}
