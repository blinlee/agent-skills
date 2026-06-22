import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { embeddingCacheKey, embeddingCachePath, loadEmbeddingCache } from './embedding-cache.js'
import { loadEmbeddingProviderConfigFromEnv } from './embedding-provider.js'
import { loadRetrievalIndex } from './index-store.js'
import type { EmbeddingProviderConfig } from './embedding-types.js'
import type { ChunkIndexStateV2 } from './types.js'

export type QueryEmbeddingReadiness = {
  status: 'not-configured' | 'ready' | 'missing-vectors' | 'missing-index'
  provider: string | null
  model: string | null
  cachePath: string | null
  currentChunkCount: number
  currentVectorKeyCount: number
  reusableVectorCount: number
  missingVectorCount: number
  staleRecordCount: number
  finalVectorCount: number
  remainingMissingVectorCount: number
}

export type KnowledgeQueryReadinessReport = {
  kind: 'knowledge'
  knowledgeRoot: string
  status: 'ready' | 'missing-index' | 'stale-index' | 'embedding-missing'
  index: {
    status: 'current' | 'missing' | 'stale'
    chunkCount: number
    rawBackedChunkCount: number
    diagnostics: string[]
  }
  embedding: QueryEmbeddingReadiness
}

export type RegistryQueryReadinessReport = {
  kind: 'registry'
  registryRoot: string
  status: 'ready' | 'partial' | 'blocked'
  wikis: Array<{
    wikiId: string
    title: string
    knowledgeRoot: string
    readiness: KnowledgeQueryReadinessReport
  }>
}

export async function buildKnowledgeQueryReadiness(input: { knowledgeRoot: string }): Promise<KnowledgeQueryReadinessReport> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const [chunkState, retrievalIndex] = await Promise.all([
    loadChunkState(knowledgeRoot),
    loadRetrievalIndex(knowledgeRoot),
  ])
  const indexStatus = !chunkState || !retrievalIndex
    ? 'missing'
    : retrievalIndex.readinessDiagnostics.length > 0
      ? 'stale'
      : 'current'
  const embedding = await buildEmbeddingReadiness(knowledgeRoot, chunkState)
  const status = indexStatus === 'missing'
    ? 'missing-index'
    : indexStatus === 'stale'
      ? 'stale-index'
      : embedding.status === 'missing-vectors'
        ? 'embedding-missing'
        : 'ready'

  return {
    kind: 'knowledge',
    knowledgeRoot,
    status,
    index: {
      status: indexStatus,
      chunkCount: chunkState?.chunks.length ?? 0,
      rawBackedChunkCount: chunkState?.chunks.filter((chunk) => chunk.rawPath).length ?? 0,
      diagnostics: retrievalIndex?.readinessDiagnostics ?? (chunkState ? [] : ['retrieval index missing or older than chunks v2 / lexical v1']),
    },
    embedding,
  }
}

export async function buildRegistryQueryReadiness(input: {
  registryRoot: string
  wikis: Array<{ wikiId: string; title: string; knowledgeRoot: string }>
}): Promise<RegistryQueryReadinessReport> {
  const registryRoot = path.resolve(input.registryRoot)
  const wikis = await Promise.all(input.wikis.map(async (wiki) => ({
    wikiId: wiki.wikiId,
    title: wiki.title,
    knowledgeRoot: path.resolve(wiki.knowledgeRoot),
    readiness: await buildKnowledgeQueryReadiness({ knowledgeRoot: wiki.knowledgeRoot }),
  })))
  const blocked = wikis.filter((wiki) => wiki.readiness.status === 'missing-index' || wiki.readiness.status === 'stale-index').length
  const embeddingMissing = wikis.filter((wiki) => wiki.readiness.status === 'embedding-missing').length
  const status = blocked === wikis.length && wikis.length > 0
    ? 'blocked'
    : blocked > 0 || embeddingMissing > 0
      ? 'partial'
      : 'ready'
  return { kind: 'registry', registryRoot, status, wikis }
}

async function buildEmbeddingReadiness(
  knowledgeRoot: string,
  chunkState: ChunkIndexStateV2 | null,
): Promise<QueryEmbeddingReadiness> {
  const config = loadEmbeddingProviderConfigFromEnv()
  if (!config) {
    return emptyEmbeddingReadiness('not-configured', null, null, chunkState)
  }
  if (!chunkState) {
    return emptyEmbeddingReadiness('missing-index', config, embeddingCachePath(knowledgeRoot, config), null)
  }

  const cachePath = embeddingCachePath(knowledgeRoot, config)
  const cache = await loadEmbeddingCache(cachePath)
  const currentKeys = new Set(chunkState.chunks.map((chunk) => embeddingCacheKey({
    provider: config.provider,
    model: config.model,
    textSha256: chunk.textSha256,
  })))
  const reusableVectorCount = [...cache.recordsByCacheKey.entries()]
    .filter(([key, record]) => currentKeys.has(key) && record.provider === config.provider && record.model === config.model)
    .length
  const staleRecordCount = cache.records.filter((record) => !currentKeys.has(record.cacheKey)).length
  const missingVectorCount = Math.max(0, currentKeys.size - reusableVectorCount)
  return {
    status: missingVectorCount > 0 ? 'missing-vectors' : 'ready',
    provider: config.provider,
    model: config.model,
    cachePath,
    currentChunkCount: chunkState.chunks.length,
    currentVectorKeyCount: currentKeys.size,
    reusableVectorCount,
    missingVectorCount,
    staleRecordCount,
    finalVectorCount: reusableVectorCount,
    remainingMissingVectorCount: missingVectorCount,
  }
}

function emptyEmbeddingReadiness(
  status: QueryEmbeddingReadiness['status'],
  config: Pick<EmbeddingProviderConfig, 'provider' | 'model'> | null,
  cachePath: string | null,
  chunkState: ChunkIndexStateV2 | null,
): QueryEmbeddingReadiness {
  return {
    status,
    provider: config?.provider ?? null,
    model: config?.model ?? null,
    cachePath,
    currentChunkCount: chunkState?.chunks.length ?? 0,
    currentVectorKeyCount: 0,
    reusableVectorCount: 0,
    missingVectorCount: 0,
    staleRecordCount: 0,
    finalVectorCount: 0,
    remainingMissingVectorCount: 0,
  }
}

async function loadChunkState(knowledgeRoot: string): Promise<ChunkIndexStateV2 | null> {
  try {
    const raw = await readFile(path.join(path.resolve(knowledgeRoot), 'system', 'index', 'chunks.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ChunkIndexStateV2>
    if (parsed.version !== 2 || parsed.schema !== 'llm-wiki.chunks.v2' || !Array.isArray(parsed.chunks)) {
      return null
    }
    return parsed as ChunkIndexStateV2
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}
