import {
  createEmbeddingProvider,
  loadEmbeddingProviderConfigFromEnv,
} from '../retrieval/embedding-provider.js'

export type ContentDedupEmbeddingResult = {
  provider: string | null
  model: string | null
  vector: number[] | null
  diagnostic: string | null
}

export async function loadContentDedupEmbedding(content: string): Promise<ContentDedupEmbeddingResult> {
  const config = loadEmbeddingProviderConfigFromEnv()
  if (!config) {
    return { provider: null, model: null, vector: null, diagnostic: 'embedding provider not configured' }
  }

  try {
    const vector = await createEmbeddingProvider(config).embed({ text: content })
    return {
      provider: config.provider,
      model: config.model,
      vector,
      diagnostic: null,
    }
  } catch (error) {
    return {
      provider: config.provider,
      model: config.model,
      vector: null,
      diagnostic: (error as Error).message,
    }
  }
}
