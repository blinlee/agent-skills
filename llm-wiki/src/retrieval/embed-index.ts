import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { embeddingCacheKey, embeddingCachePath, loadEmbeddingCache, makeEmbeddingRecord, writeEmbeddingCache } from './embedding-cache.js'
import { writeEmbeddingModelMeta } from './embedding-meta.js'
import { createEmbeddingProvider, loadEmbeddingProviderConfigFromEnv, missingEmbeddingProviderMessage } from './embedding-provider.js'
import type { EmbeddingProvider, EmbeddingProviderConfig } from './embedding-types.js'
import type { ChunkIndexStateV2 } from './types.js'

export type EmbedIndexInput = {
  knowledgeRoot: string
  provider?: EmbeddingProvider
  providerConfig?: EmbeddingProviderConfig
  now?: string
  concurrency?: number
  batchSize?: number
}

export type EmbedIndexResult = {
  knowledgeRoot: string
  provider: string
  model: string
  cachePath: string
  chunkCount: number
  reusedCount: number
  missingCount: number
  embeddedCount: number
  staleRemovedCount: number
  batchSize: number
  concurrency: number
  batchCount: number
  providerRequestCount: number
  coverage: {
    currentChunkCount: number
    currentVectorKeyCount: number
    reusableVectorCount: number
    missingVectorCount: number
    staleRecordCount: number
    finalVectorCount: number
    remainingMissingVectorCount: number
  }
}

export async function runEmbedIndex(input: EmbedIndexInput): Promise<EmbedIndexResult> {
  const root = path.resolve(input.knowledgeRoot)
  const config = input.providerConfig ?? input.provider?.config ?? loadEmbeddingProviderConfigFromEnv()
  if (!config) {
    throw new Error(missingEmbeddingProviderMessage())
  }

  const provider = input.provider ?? createEmbeddingProvider(config)
  const chunkState = await loadChunkIndexV2(root)
  const cachePath = embeddingCachePath(root, config)
  const cache = await loadEmbeddingCache(cachePath)
  const currentChunkKeys = new Set(chunkState.chunks.map((chunk) => embeddingCacheKey({
    provider: config.provider,
    model: config.model,
    textSha256: chunk.textSha256,
  })))
  const reusable = new Map([...cache.recordsByCacheKey.entries()].filter(([key, record]) => currentChunkKeys.has(key) && record.model === config.model && record.provider === config.provider))
  const staleRemovedCount = cache.records.filter((record) => !currentChunkKeys.has(record.cacheKey)).length
  const missingChunks = chunkState.chunks.filter((chunk) => !reusable.has(embeddingCacheKey({
    provider: config.provider,
    model: config.model,
    textSha256: chunk.textSha256,
  })))
  const createdAt = input.now ?? new Date().toISOString()
  const newRecords = []
  const providerSupportsBatch = Boolean(provider.embedBatch && provider.supportsBatch !== false)
  const concurrency = normalizePositiveInt(input.concurrency ?? Number(process.env.LLM_WIKI_EMBEDDING_CONCURRENCY ?? process.env.llm_wiki_embedding_concurrency ?? 4), 4)
  const configuredBatchSize = normalizePositiveInt(input.batchSize ?? Number(process.env.LLM_WIKI_EMBEDDING_BATCH_SIZE ?? process.env.llm_wiki_embedding_batch_size ?? 32), 32)
  const batchSize = providerSupportsBatch ? configuredBatchSize : 1
  const batches = chunkArray(missingChunks, batchSize)
  let providerRequestCount = 0

  for (let offset = 0; offset < batches.length; offset += concurrency) {
    const group = batches.slice(offset, offset + concurrency)
    const records = await Promise.all(group.map(async (batch) => {
      if (providerSupportsBatch) {
        providerRequestCount += 1
        const vectors = await provider.embedBatch!(batch.map((chunk) => ({ text: chunk.text })))
        return batch.map((chunk, index) => makeEmbeddingRecord({
          provider: config.provider,
          model: config.model,
          textSha256: chunk.textSha256,
          chunkId: chunk.chunkId,
          pageTarget: chunk.pageTarget,
          vector: vectors[index]!,
          createdAt,
        }))
      }

      return Promise.all(batch.map(async (chunk) => {
        providerRequestCount += 1
        const vector = await provider.embed({ text: chunk.text })
        return makeEmbeddingRecord({
          provider: config.provider,
          model: config.model,
          textSha256: chunk.textSha256,
          chunkId: chunk.chunkId,
          pageTarget: chunk.pageTarget,
          vector,
          createdAt,
        })
      }))
    }))
    newRecords.push(...records.flat())
  }

  const records = [...reusable.values(), ...newRecords]
  await writeEmbeddingCache(cachePath, records)
  const firstRecord = records.find((record) => record.dims > 0)
  if (firstRecord) {
    await writeEmbeddingModelMeta(root, config, { dims: firstRecord.dims, updatedAt: createdAt })
  }

  return {
    knowledgeRoot: root,
    provider: config.provider,
    model: config.model,
    cachePath,
    chunkCount: chunkState.chunks.length,
    reusedCount: reusable.size,
    missingCount: missingChunks.length,
    embeddedCount: newRecords.length,
    staleRemovedCount,
    batchSize,
    concurrency,
    batchCount: batches.length,
    providerRequestCount,
    coverage: {
      currentChunkCount: chunkState.chunks.length,
      currentVectorKeyCount: currentChunkKeys.size,
      reusableVectorCount: reusable.size,
      missingVectorCount: missingChunks.length,
      staleRecordCount: staleRemovedCount,
      finalVectorCount: records.length,
      remainingMissingVectorCount: Math.max(0, currentChunkKeys.size - records.length),
    },
  }
}

async function loadChunkIndexV2(knowledgeRoot: string): Promise<ChunkIndexStateV2> {
  const chunksPath = path.join(knowledgeRoot, 'system', 'index', 'chunks.json')
  let raw: string
  try {
    raw = await readFile(chunksPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Embedding index requires chunks.json v2. Run llm-wiki index ${knowledgeRoot} first.`)
    }
    throw error
  }

  const state = JSON.parse(raw) as Partial<ChunkIndexStateV2>
  if (state.version !== 2 || state.schema !== 'llm-wiki.chunks.v2' || !Array.isArray(state.chunks)) {
    throw new Error(`Embedding index requires chunks.json v2. Run llm-wiki index ${knowledgeRoot} first.`)
  }
  return state as ChunkIndexStateV2
}

function normalizePositiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size))
  }
  return chunks
}
