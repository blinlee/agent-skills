export type EmbeddingVector = number[]

export type EmbeddingProviderName = 'local-http' | 'ollama' | 'lm-studio' | 'custom-endpoint'
export type EmbeddingRequestFormat = 'ollama-embed' | 'ollama-embeddings' | 'openai-compatible'

export type EmbeddingProviderConfig = {
  provider: EmbeddingProviderName
  /** Local embedding endpoint. Examples: Ollama /api/embed, LM Studio /v1/embeddings, or any OpenAI-compatible local endpoint. */
  endpoint: string
  /** Any local model name. Recommended: bge-m3; lightweight fallback: nomic-embed-text. */
  model: string
  /** Optional expected vector dimensions; mismatch throws a clear error. */
  dimensions?: number
  /** Request timeout in milliseconds. */
  timeoutMs: number
  /** Optional wire format override. If omitted, inferred from endpoint path. */
  format?: EmbeddingRequestFormat
}

export type EmbeddingInput = {
  text: string
}

export type EmbeddingProvider = {
  name: EmbeddingProviderName
  config: EmbeddingProviderConfig
  supportsBatch?: boolean
  embed(input: EmbeddingInput): Promise<EmbeddingVector>
  embedBatch?(inputs: EmbeddingInput[]): Promise<EmbeddingVector[]>
}

export type EmbeddingCacheRecord = {
  version: 1
  provider: EmbeddingProviderName
  model: string
  textSha256: string
  cacheKey: string
  chunkId: string
  pageTarget: string
  dims: number
  vector: EmbeddingVector
  createdAt: string
}

export type EmbeddingCacheLoadResult = {
  records: EmbeddingCacheRecord[]
  recordsByCacheKey: Map<string, EmbeddingCacheRecord>
  recordsByTextSha256: Map<string, EmbeddingCacheRecord>
}
