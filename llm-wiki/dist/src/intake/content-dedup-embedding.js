import { createEmbeddingProvider, loadEmbeddingProviderConfigFromEnv, } from '../retrieval/embedding-provider.js';
export async function loadContentDedupEmbedding(content) {
    const config = loadEmbeddingProviderConfigFromEnv();
    if (!config) {
        return { provider: null, model: null, vector: null, diagnostic: 'embedding provider not configured' };
    }
    try {
        const vector = await createEmbeddingProvider(config).embed({ text: content });
        return {
            provider: config.provider,
            model: config.model,
            vector,
            diagnostic: null,
        };
    }
    catch (error) {
        return {
            provider: config.provider,
            model: config.model,
            vector: null,
            diagnostic: error.message,
        };
    }
}
