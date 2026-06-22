import { defaultFormatForProvider, inferFormat, loadEmbeddingProviderConfig, parseFormat } from './embedding-config.js'
import type { EmbeddingProvider, EmbeddingProviderConfig, EmbeddingRequestFormat, EmbeddingVector } from './embedding-types.js'

export function loadEmbeddingProviderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProviderConfig | null {
  return loadEmbeddingProviderConfig(env)
}

export type EmbeddingProviderDiagnostic = {
  provider: EmbeddingProviderConfig['provider']
  endpoint: string
  model: string
  format: EmbeddingRequestFormat
  ready: boolean
  diagnostics: string[]
}

export function diagnoseEmbeddingProviderConfig(config: EmbeddingProviderConfig | null): EmbeddingProviderDiagnostic | null {
  if (!config) {
    return null
  }
  const diagnostics: string[] = []
  const format = config.format ?? defaultFormatForProvider(config.provider, config.endpoint) ?? inferFormat(config.endpoint)
  let ready = true

  try {
    // Validate endpoint early so cross-machine failures are explainable before fetch.
    new URL(config.endpoint)
  } catch {
    ready = false
    diagnostics.push(`invalid endpoint URL: ${config.endpoint}`)
  }

  if (config.provider === 'ollama' && !config.endpoint.includes('/api/')) {
    diagnostics.push('ollama provider usually expects /api/embed or /api/embeddings endpoint')
  }
  if (config.provider === 'lm-studio' && !config.endpoint.endsWith('/v1/embeddings')) {
    diagnostics.push('lm-studio provider usually expects OpenAI-compatible /v1/embeddings endpoint')
  }
  if (config.provider === 'custom-endpoint' && !config.format) {
    diagnostics.push('custom-endpoint inferred format from endpoint; set LLM_WIKI_EMBEDDING_FORMAT for portability')
  }
  if (config.dimensions !== undefined) {
    diagnostics.push(`expected dimensions: ${config.dimensions}`)
  }
  diagnostics.push(`wire format: ${format}`)
  diagnostics.push(`timeout ms: ${config.timeoutMs}`)

  return {
    provider: config.provider,
    endpoint: config.endpoint,
    model: config.model,
    format,
    ready,
    diagnostics,
  }
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  return new LocalHttpEmbeddingProvider(config)
}

export function missingEmbeddingProviderMessage(): string {
  return [
    'Embedding provider is not configured. Query still works with lexical retrieval; embed-index is manual.',
    'Configure a local text embedding service, for example Ollama + bge-m3:',
    '  ollama pull bge-m3',
    '  LLM_WIKI_EMBEDDING_ENDPOINT=http://localhost:11434/api/embed',
    '  LLM_WIKI_EMBEDDING_MODEL=bge-m3',
    'Lightweight fallback example: LLM_WIKI_EMBEDDING_MODEL=nomic-embed-text.',
  ].join('\n')
}

class LocalHttpEmbeddingProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderConfig['provider']
  readonly supportsBatch: boolean

  constructor(readonly config: EmbeddingProviderConfig) {
    this.name = config.provider
    const format = this.config.format ?? inferFormat(this.config.endpoint)
    this.supportsBatch = format !== 'ollama-embeddings'
  }

  async embed(input: { text: string }): Promise<EmbeddingVector> {
    return (await this.requestEmbeddings([input.text]))[0]!
  }

  async embedBatch(inputs: Array<{ text: string }>): Promise<EmbeddingVector[]> {
    if (inputs.length === 0) {
      return []
    }
    if (!this.supportsBatch) {
      const vectors: EmbeddingVector[] = []
      for (const input of inputs) {
        vectors.push(await this.embed(input))
      }
      return vectors
    }
    return this.requestEmbeddings(inputs.map((input) => input.text))
  }

  private async requestEmbeddings(texts: string[]): Promise<EmbeddingVector[]> {
    const format = this.config.format ?? inferFormat(this.config.endpoint)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const input = texts.length === 1 ? texts[0]! : texts

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildRequestBody(format, this.config.model, input)),
        signal: controller.signal,
      })

      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Embedding provider HTTP ${response.status}: ${text.slice(0, 500)}`)
      }

      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        throw new Error(`Embedding provider returned non-JSON response: ${text.slice(0, 120)}`)
      }

      const vectors = parseEmbeddingResponse(format, body, texts.length)
      for (const vector of vectors) {
        validateVector(vector, this.config.dimensions)
      }
      return vectors
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Embedding provider timed out after ${this.config.timeoutMs}ms: ${this.config.endpoint}`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

function buildRequestBody(format: EmbeddingRequestFormat, model: string, text: string | string[]): unknown {
  switch (format) {
    case 'ollama-embed':
      return { model, input: text }
    case 'ollama-embeddings':
      if (Array.isArray(text)) {
        throw new Error('Ollama /api/embeddings does not support batch embedding input.')
      }
      return { model, prompt: text }
    case 'openai-compatible':
      return { model, input: text }
  }
}

function parseEmbeddingResponse(format: EmbeddingRequestFormat, body: unknown, expectedCount: number): EmbeddingVector[] {
  if (!isRecord(body)) {
    throw new Error('Embedding provider returned a non-object JSON response.')
  }

  if (format === 'ollama-embed') {
    const embeddings = body.embeddings
    if (Array.isArray(embeddings) && embeddings.every((value) => Array.isArray(value))) {
      return validateVectorCount(embeddings as number[][], expectedCount, 'Ollama /api/embed')
    }
    const embedding = body.embedding
    if (Array.isArray(embedding) && expectedCount === 1) {
      return [embedding as number[]]
    }
    throw new Error('Ollama /api/embed response missing embeddings[0].')
  }

  if (format === 'ollama-embeddings') {
    const embedding = body.embedding
    if (Array.isArray(embedding) && expectedCount === 1) {
      return [embedding as number[]]
    }
    throw new Error('Ollama /api/embeddings response missing embedding.')
  }

  const data = body.data
  if (Array.isArray(data) && data.every((item) => isRecord(item) && Array.isArray(item.embedding))) {
    const rows = data as Array<{ embedding: number[]; index?: number }>
    const ordered = rows.every((row) => typeof row.index === 'number')
      ? [...rows].sort((left, right) => left.index! - right.index!)
      : rows
    return validateVectorCount(ordered.map((row) => row.embedding), expectedCount, 'OpenAI-compatible /v1/embeddings')
  }
  throw new Error('OpenAI-compatible /v1/embeddings response missing data[0].embedding.')
}

function validateVectorCount(vectors: EmbeddingVector[], expectedCount: number, source: string): EmbeddingVector[] {
  if (vectors.length !== expectedCount) {
    throw new Error(`${source} response vector count mismatch: expected ${expectedCount}, got ${vectors.length}.`)
  }
  return vectors
}

function validateVector(vector: EmbeddingVector, expectedDimensions?: number): void {
  if (!Array.isArray(vector) || vector.length === 0 || !vector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new Error('Embedding provider returned an invalid vector.')
  }
  if (expectedDimensions !== undefined && vector.length !== expectedDimensions) {
    throw new Error(`Embedding dimensions mismatch: expected ${expectedDimensions}, got ${vector.length}.`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
