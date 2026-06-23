import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBuildIndexCommand, runCliFromArgv, runIngestCommand } from '../../src/cli.js'
import { embeddingCacheDatabasePath, embeddingCachePath, loadEmbeddingCache, textSha256, writeEmbeddingCache } from '../../src/retrieval/embedding-cache.js'
import { embeddingModelMetaPath } from '../../src/retrieval/embedding-meta.js'
import { loadEmbeddingProviderConfigFromEnv } from '../../src/retrieval/embedding-provider.js'
import { runEmbedIndex } from '../../src/retrieval/embed-index.js'
import type { EmbeddingProvider, EmbeddingProviderConfig } from '../../src/retrieval/embedding-types.js'
import { loadEntityExtractionConfigFromEnv, loadEntityExtractionIndex } from '../../src/retrieval/entity-extract.js'
import { fuseLexicalScoresWithRrf, loadQueryExpansionConfigFromEnv } from '../../src/retrieval/expansion.js'
import { scoreGraphBoosts } from '../../src/retrieval/graph.js'
import { scoreHybrid } from '../../src/retrieval/hybrid.js'
import { loadHydeConfigFromEnv } from '../../src/retrieval/hyde.js'
import { buildLexicalIndex } from '../../src/retrieval/lexical.js'
import { loadRerankConfigFromEnv, rerankHybridEntries } from '../../src/retrieval/rerank.js'
import { retrieveChunks } from '../../src/retrieval/retrieval.js'
import { scoreTaxonomyBoosts } from '../../src/retrieval/taxonomy.js'
import { tokenize } from '../../src/retrieval/tokenize.js'
import type { ChunkIndexEntryV2, ChunkIndexStateV2 } from '../../src/retrieval/types.js'
import { runIngestCommandWithCuration } from '../helpers/curation.js'

const tempRoots: string[] = []
const embeddingEnvKeys = [
  'LLM_WIKI_EMBEDDING_ENDPOINT',
  'llm_wiki_embedding_endpoint',
  'LLM_WIKI_EMBEDDING_MODEL',
  'llm_wiki_embedding_model',
  'LLM_WIKI_EMBEDDING_PROVIDER',
  'llm_wiki_embedding_provider',
  'LLM_WIKI_EMBEDDING_DIMENSIONS',
  'llm_wiki_embedding_dimensions',
  'LLM_WIKI_EMBEDDING_TIMEOUT_MS',
  'llm_wiki_embedding_timeout_ms',
  'LLM_WIKI_EMBEDDING_FORMAT',
  'llm_wiki_embedding_format',
  'LLM_WIKI_RERANK_ENDPOINT',
  'llm_wiki_rerank_endpoint',
  'LLM_WIKI_RERANK_MODEL',
  'llm_wiki_rerank_model',
  'LLM_WIKI_RERANK_TIMEOUT_MS',
  'llm_wiki_rerank_timeout_ms',
  'LLM_WIKI_RERANK_TOP_N',
  'llm_wiki_rerank_top_n',
  'LLM_WIKI_HYDE_ENDPOINT',
  'llm_wiki_hyde_endpoint',
  'LLM_WIKI_HYDE_MODEL',
  'llm_wiki_hyde_model',
  'LLM_WIKI_HYDE_TIMEOUT_MS',
  'llm_wiki_hyde_timeout_ms',
  'LLM_WIKI_HYDE_PROMPT_TEMPLATE',
  'llm_wiki_hyde_prompt_template',
  'LLM_WIKI_HYDE_PROMPT',
  'llm_wiki_hyde_prompt',
  'LLM_WIKI_EXPANSION_ENDPOINT',
  'llm_wiki_expansion_endpoint',
  'LLM_WIKI_EXPANSION_MODEL',
  'llm_wiki_expansion_model',
  'LLM_WIKI_EXPANSION_TIMEOUT_MS',
  'llm_wiki_expansion_timeout_ms',
  'LLM_WIKI_EXPANSION_COUNT',
  'llm_wiki_expansion_count',
  'LLM_WIKI_EXPANSION_PROMPT_TEMPLATE',
  'llm_wiki_expansion_prompt_template',
  'LLM_WIKI_EXPANSION_PROMPT',
  'llm_wiki_expansion_prompt',
  'LLM_WIKI_ENTITY_ENDPOINT',
  'llm_wiki_entity_endpoint',
  'LLM_WIKI_ENTITY_MODEL',
  'llm_wiki_entity_model',
  'LLM_WIKI_ENTITY_TIMEOUT_MS',
  'llm_wiki_entity_timeout_ms',
  'LLM_WIKI_ENTITY_MAX_RECORDS',
  'llm_wiki_entity_max_records',
  'LLM_WIKI_ENTITY_MAX_ENTITY_RECORDS',
  'llm_wiki_entity_max_entity_records',
  'LLM_WIKI_ENTITY_MAX_INPUT_CHARS',
  'llm_wiki_entity_max_input_chars',
  'LLM_WIKI_ENTITY_LANGUAGE',
  'llm_wiki_entity_language',
  'LLM_WIKI_ENTITY_PROMPT_TEMPLATE',
  'llm_wiki_entity_prompt_template',
  'LLM_WIKI_ENTITY_PROMPT',
  'llm_wiki_entity_prompt',
] as const

const providerConfig: EmbeddingProviderConfig = {
  provider: 'local-http',
  endpoint: 'http://127.0.0.1:11434/api/embed',
  model: 'bge-m3',
  timeoutMs: 30_000,
}

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('embedding cache and provider integration', () => {
  it('fails embed-index with clear guidance when no provider is configured', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-embed-missing-'))
    tempRoots.push(knowledgeRoot)

    await expect(runEmbedIndex({ knowledgeRoot })).rejects.toThrow(/Embedding provider is not configured[\s\S]*Query still works with lexical retrieval/)
  })

  it('writes embedding cache with a mock provider and reuses it on a second run', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-embed-cache-')
    const provider = mockProvider()

    const first = await runEmbedIndex({ knowledgeRoot, provider, now: '2026-06-12T00:00:00.000Z' })
    const cachePath = embeddingCachePath(knowledgeRoot, providerConfig)
    const cacheDbPath = embeddingCacheDatabasePath(knowledgeRoot, providerConfig)
    const metaPath = embeddingModelMetaPath(knowledgeRoot, providerConfig)
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { provider: string; model: string; dims: number }
    const firstCalls = provider.calls.length

    expect(cachePath).toBe(path.join(knowledgeRoot, 'system', 'index', 'embeddings', 'local-http-bge-m3', 'vectors.db'))
    expect(cacheDbPath).toBe(cachePath)
    await expect(access(cacheDbPath)).resolves.toBeUndefined()
    expect(meta).toMatchObject({ provider: 'local-http', model: 'bge-m3', dims: 2 })
    expect(first.embeddedCount).toBe(first.chunkCount)
    expect(first.reusedCount).toBe(0)
    expect(firstCalls).toBe(first.chunkCount)

    const second = await runEmbedIndex({ knowledgeRoot, provider, now: '2026-06-12T00:01:00.000Z' })

    expect(provider.calls).toHaveLength(firstCalls)
    expect(second.embeddedCount).toBe(0)
    expect(second.reusedCount).toBe(second.coverage.currentVectorKeyCount)
    expect(second.coverage.currentVectorKeyCount).toBeLessThanOrEqual(second.chunkCount)
  })

  it('embeds missing chunks through provider batch calls and reports current coverage', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-embed-batch-')
    const provider = mockBatchProvider()

    const first = await runEmbedIndex({
      knowledgeRoot,
      provider,
      now: '2026-06-21T00:00:00.000Z',
      batchSize: 3,
      concurrency: 2,
    })

    expect(first.missingCount).toBe(first.chunkCount)
    expect(first.embeddedCount).toBe(first.chunkCount)
    expect(first.batchSize).toBe(3)
    expect(first.concurrency).toBe(2)
    expect(first.batchCount).toBe(Math.ceil(first.chunkCount / 3))
    expect(first.providerRequestCount).toBe(first.batchCount)
    expect(provider.batchCalls).toHaveLength(first.batchCount)
    expect(provider.batchCalls.flat()).toHaveLength(first.chunkCount)
    expect(first.coverage).toMatchObject({
      currentChunkCount: first.chunkCount,
      reusableVectorCount: 0,
      missingVectorCount: first.chunkCount,
      staleRecordCount: 0,
      finalVectorCount: first.chunkCount,
      remainingMissingVectorCount: 0,
    })
    expect(first.coverage.currentVectorKeyCount).toBeLessThanOrEqual(first.chunkCount)

    const second = await runEmbedIndex({
      knowledgeRoot,
      provider,
      now: '2026-06-21T00:01:00.000Z',
      batchSize: 3,
      concurrency: 2,
    })

    expect(second.missingCount).toBe(0)
    expect(second.embeddedCount).toBe(0)
    expect(second.providerRequestCount).toBe(0)
    expect(second.coverage).toEqual({
      currentChunkCount: second.chunkCount,
      currentVectorKeyCount: second.chunkCount,
      reusableVectorCount: second.chunkCount,
      missingVectorCount: 0,
      staleRecordCount: 0,
      finalVectorCount: second.chunkCount,
      remainingMissingVectorCount: 0,
    })
  })

  it('loads cache records for all supported local embedding provider names', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-embed-provider-cache-'))
    tempRoots.push(knowledgeRoot)
    const providers = ['local-http', 'ollama', 'lm-studio', 'custom-endpoint'] as const

    for (const provider of providers) {
      const config = { ...providerConfig, provider }
      const cachePath = embeddingCachePath(knowledgeRoot, config)
      await writeEmbeddingCache(cachePath, [{
        version: 1 as const,
        provider,
        model: 'bge-m3',
        textSha256: `${provider}-hash`,
        cacheKey: `${provider}:bge-m3:${provider}-hash`,
        chunkId: `${provider}-chunk`,
        pageTarget: 'sources/provider-cache',
        dims: 2,
        vector: [1, 0],
        createdAt: '2026-06-13T00:00:00.000Z',
      }])

      const cache = await loadEmbeddingCache(cachePath)
      expect(cache.records).toHaveLength(1)
      expect(cache.records[0]!.provider).toBe(provider)
      await expect(access(cachePath)).resolves.toBeUndefined()
    }
  })

  it('re-embeds one stale chunk and removes the stale cache record', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-embed-stale-')
    const provider = mockProvider()
    await runEmbedIndex({ knowledgeRoot, provider, now: '2026-06-12T00:00:00.000Z' })

    const chunksPath = path.join(knowledgeRoot, 'system', 'index', 'chunks.json')
    const state = JSON.parse(await readFile(chunksPath, 'utf8')) as ChunkIndexStateV2
    const oldHash = state.chunks[0]!.textSha256
    state.chunks[0] = {
      ...state.chunks[0]!,
      text: `${state.chunks[0]!.text}\n\nStale chunk new embedding text.`,
    }
    const newHash = textSha256(state.chunks[0]!.text)
    state.chunks[0]!.textSha256 = newHash
    await writeFile(chunksPath, JSON.stringify(state, null, 2), 'utf8')

    const callsBefore = provider.calls.length
    const result = await runEmbedIndex({ knowledgeRoot, provider, now: '2026-06-12T00:02:00.000Z' })
    const cache = await loadEmbeddingCache(embeddingCachePath(knowledgeRoot, providerConfig))

    expect(provider.calls.length - callsBefore).toBe(1)
    expect(result.embeddedCount).toBe(1)
    expect(result.staleRemovedCount).toBe(1)
    expect(cache.recordsByTextSha256.has(oldHash)).toBe(false)
    expect(cache.recordsByTextSha256.has(newHash)).toBe(true)
  })

  it('reports embedding model meta mismatches before silently falling back to lexical retrieval', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-model-meta-mismatch-')
    const oldConfig = { ...providerConfig, model: 'old-embed-model' }
    await mkdir(path.dirname(embeddingModelMetaPath(knowledgeRoot, oldConfig)), { recursive: true })
    await writeFile(embeddingModelMetaPath(knowledgeRoot, oldConfig), JSON.stringify({
      version: 1,
      schema: 'llm-wiki.embedding-model-meta.v1',
      provider: 'local-http',
      model: 'old-embed-model',
      dims: 768,
      updatedAt: '2026-06-19T00:00:00.000Z',
    }), 'utf8')
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)

    const result = await retrieveChunks({ knowledgeRoot, question: 'compiler', limit: 1 })

    expect(result.diagnostics.join('\n')).toContain('embedding model meta mismatch: current local-http:bge-m3; existing cache uses local-http:old-embed-model (768 dims)')
    expect(result.diagnostics.join('\n')).toContain('Run llm-wiki embed-index')
  })

  it('reports embedding provider meta drift before silently falling back to lexical retrieval', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-provider-meta-mismatch-')
    const oldConfig = { ...providerConfig, provider: 'ollama' as const, model: 'bge-m3' }
    await mkdir(path.dirname(embeddingModelMetaPath(knowledgeRoot, oldConfig)), { recursive: true })
    await writeFile(embeddingModelMetaPath(knowledgeRoot, oldConfig), JSON.stringify({
      version: 1,
      schema: 'llm-wiki.embedding-model-meta.v1',
      provider: 'ollama',
      model: 'bge-m3',
      dims: 768,
      updatedAt: '2026-06-19T00:00:00.000Z',
    }), 'utf8')
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)

    const result = await retrieveChunks({ knowledgeRoot, question: 'compiler', limit: 1 })

    expect(result.diagnostics.join('\n')).toContain('embedding model meta mismatch: current local-http:bge-m3; existing cache uses ollama:bge-m3 (768 dims)')
    expect(result.diagnostics.join('\n')).toContain('Run llm-wiki embed-index')
  })

  it('disables embedding retrieval when actual query vector dims differ from current cache dims', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-query-vector-dim-mismatch-')
    const provider = mockProvider()
    await runEmbedIndex({ knowledgeRoot, provider, now: '2026-06-20T00:00:00.000Z' })
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))

    const result = await retrieveChunks({ knowledgeRoot, question: 'compiler', limit: 1 })

    expect(result.mode).toBe('matched')
    expect(result.diagnostics.join('\n')).toContain('embedding dimension meta mismatch: query vector has 3 dims; cache records 2 dims for local-http:bge-m3')
    expect(result.diagnostics).toContain('embedding query vector dimension mismatch; using lexical retrieval only')
    expect(result.signalSummary.signalCounts.embedding).toBe(0)
  })

  it('does not report old sibling model meta when the current embedding cache matches', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-model-meta-current-')
    const provider = mockProvider()
    await runEmbedIndex({ knowledgeRoot, provider, now: '2026-06-20T00:00:00.000Z' })
    const oldConfig = { ...providerConfig, model: 'old-embed-model' }
    await mkdir(path.dirname(embeddingModelMetaPath(knowledgeRoot, oldConfig)), { recursive: true })
    await writeFile(embeddingModelMetaPath(knowledgeRoot, oldConfig), JSON.stringify({
      version: 1,
      schema: 'llm-wiki.embedding-model-meta.v1',
      provider: 'local-http',
      model: 'old-embed-model',
      dims: 768,
      updatedAt: '2026-06-19T00:00:00.000Z',
    }), 'utf8')
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string }
      return new Response(JSON.stringify({ data: [{ embedding: vectorFor(body.input ?? '') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const result = await retrieveChunks({ knowledgeRoot, question: 'compiler', limit: 1 })

    expect(result.diagnostics.join('\n')).not.toContain('old-embed-model')
  })

  it('rejects non-positive timeout config before any setTimeout can receive NaN or invalid values', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-embedding-config-'))
    tempRoots.push(configDir)
    const configPath = path.join(configDir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        endpoint: 'http://127.0.0.1:11434/api/embed',
        model: 'bge-m3',
        timeoutMs: 0,
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)

    expect(() => loadEmbeddingProviderConfigFromEnv()).toThrow(/Invalid embeddingProvider\.timeoutMs: 0\. Must be a positive integer\./)
  })
})

async function buildSampleIndex(prefix: string): Promise<string> {
  const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(knowledgeRoot)
  await runIngestCommandWithCuration({
    knowledgeRoot,
    input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
  })
  await runBuildIndexCommand({ knowledgeRoot })
  return knowledgeRoot
}

function stubNoEmbeddingProvider(): void {
  for (const key of embeddingEnvKeys) {
    vi.stubEnv(key, '')
  }
  vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `llm-wiki-empty-config-${Date.now()}-${Math.random()}.json`))
}

function mockProvider(): EmbeddingProvider & { calls: string[] } {
  const calls: string[] = []
  return {
    name: 'local-http',
    config: providerConfig,
    calls,
    async embed(input) {
      calls.push(input.text)
      return vectorFor(input.text)
    },
  }
}

function mockBatchProvider(): EmbeddingProvider & { batchCalls: string[][] } {
  const batchCalls: string[][] = []
  return {
    name: 'local-http',
    config: providerConfig,
    supportsBatch: true,
    batchCalls,
    async embed(input) {
      batchCalls.push([input.text])
      return vectorFor(input.text)
    },
    async embedBatch(inputs) {
      batchCalls.push(inputs.map((input) => input.text))
      return inputs.map((input) => vectorFor(input.text))
    },
  }
}

function vectorFor(text: string): number[] {
  return [text.length % 17 + 1, text.charCodeAt(0) % 11 + 1]
}

function chunk(input: { chunkId: string; textSha256: string; text: string }): ChunkIndexEntryV2 {
  return {
    version: 2,
    id: input.chunkId,
    chunkId: input.chunkId,
    pageTarget: `sources/${input.chunkId}`,
    pageTitle: input.chunkId,
    filePath: `/tmp/${input.chunkId}.md`,
    sourceRef: 'fixture',
    heading: input.chunkId,
    headingPath: [input.chunkId],
    level: 1,
    startLine: 1,
    endLine: 3,
    anchor: input.chunkId,
    text: input.text,
    textSha256: input.textSha256,
    tokenCountApprox: 4,
    links: [],
    metadata: {
      docType: 'source',
      section: 'sources',
      slug: input.chunkId,
    },
  }
}
