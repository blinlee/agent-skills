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

describe('query expansion and entity extraction integration', () => {
  it('fuses original and expanded lexical rankings with RRF while keeping original query weight higher', () => {
    const fused = fuseLexicalScoresWithRrf({
      original: new Map([
        ['doc-original', { score: 10, terms: ['car'] }],
        ['doc-shared', { score: 8, terms: ['holder'] }],
      ]),
      expanded: [{
        query: 'automobile cradle',
        scores: new Map([
          ['doc-shared', { score: 9, terms: ['automobile'] }],
          ['doc-expanded', { score: 7, terms: ['cradle'] }],
        ]),
      }],
    })

    expect([...fused.keys()].slice(0, 2)).toEqual(['doc-shared', 'doc-original'])
    expect(fused.get('doc-shared')?.terms).toEqual(['automobile', 'holder'])
    expect(fused.get('doc-original')?.score).toBeCloseTo(1 / 60, 9)
    expect(fused.get('doc-expanded')?.score).toBeCloseTo(0.7 * (1 / 61), 9)
  })

  it('applies query expansion to lexical retrieval through RRF when configured', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-expansion-retrieval-'))
    tempRoots.push(knowledgeRoot)
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      queryExpansionProvider: {
        endpoint: 'http://127.0.0.1:9999/expand',
        model: 'local-chat',
        count: 2,
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      const body = JSON.parse(String(init?.body ?? '{}')) as { question?: string; count?: number }
      expect(target).toBe('http://127.0.0.1:9999/expand')
      expect(body.question).toBe('car holder')
      expect(body.count).toBe(2)
      return new Response(JSON.stringify({ queries: ['automobile cradle', 'dashboard mount'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const expandedOnly = chunk({ chunkId: 'chunk-expansion-target', textSha256: 'expansion-target-hash', text: 'automobile cradle magnetic dashboard mount' })
    const unrelated = chunk({ chunkId: 'chunk-expansion-unrelated', textSha256: 'expansion-unrelated-hash', text: 'compiler parser runtime notes' })
    const chunks = [expandedOnly, unrelated]
    await mkdir(path.join(knowledgeRoot, 'system', 'index'), { recursive: true })
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'chunks.json'), JSON.stringify({
      version: 2,
      schema: 'llm-wiki.chunks.v2',
      knowledgeRoot,
      generatedAt: '2026-06-18T00:00:00.000Z',
      chunks,
    }, null, 2), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'lexical.json'), JSON.stringify(buildLexicalIndex({
      knowledgeRoot,
      generatedAt: '2026-06-18T00:00:00.000Z',
      chunks,
    }), null, 2), 'utf8')

    const result = await retrieveChunks({ knowledgeRoot, question: 'car holder', limit: 2 })

    expect(result.mode).toBe('matched')
    expect(result.hits[0]!.chunk.chunkId).toBe(expandedOnly.chunkId)
    expect(result.hits[0]!.reasons).toEqual(expect.arrayContaining(['term:automobile', 'term:cradle']))
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      'query expansion generated 2 query variant(s)',
      'query expansion fused lexical rankings with RRF from 2 variant(s)',
      'embedding provider not configured; using lexical retrieval only',
    ]))
  })

  it('falls back to domain synonym query expansion when no expansion endpoint is configured', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-expansion-synonyms-'))
    tempRoots.push(knowledgeRoot)
    vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `llm-wiki-empty-config-${Date.now()}-${Math.random()}.json`))

    const expandedOnly = chunk({ chunkId: 'chunk-synonym-target', textSha256: 'synonym-target-hash', text: 'automobile holder dashboard accessory' })
    const unrelated = chunk({ chunkId: 'chunk-synonym-unrelated', textSha256: 'synonym-unrelated-hash', text: 'compiler parser runtime notes' })
    const chunks = [expandedOnly, unrelated]
    await mkdir(path.join(knowledgeRoot, 'system', 'index'), { recursive: true })
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'chunks.json'), JSON.stringify({
      version: 2,
      schema: 'llm-wiki.chunks.v2',
      knowledgeRoot,
      generatedAt: '2026-06-18T00:00:00.000Z',
      chunks,
    }, null, 2), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'lexical.json'), JSON.stringify(buildLexicalIndex({
      knowledgeRoot,
      generatedAt: '2026-06-18T00:00:00.000Z',
      chunks,
    }), null, 2), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'domain-synonyms.json'), JSON.stringify({
      car: ['automobile'],
    }, null, 2), 'utf8')

    const result = await retrieveChunks({ knowledgeRoot, question: 'car holder', limit: 2 })

    expect(result.mode).toBe('matched')
    expect(result.hits[0]!.chunk.chunkId).toBe(expandedOnly.chunkId)
    expect(result.hits[0]!.reasons).toEqual(expect.arrayContaining(['term:automobile', 'term:holder']))
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      'query expansion used 1 domain synonym variant(s)',
      'query expansion fused lexical rankings with RRF from 1 variant(s)',
      'embedding provider not configured; using lexical retrieval only',
    ]))
  })

  it('loads query expansion config from host-local config and rejects invalid count', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-expansion-config-'))
    tempRoots.push(configDir)
    const configPath = path.join(configDir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      queryExpansionProvider: {
        endpoint: 'http://127.0.0.1:9999/expand',
        model: 'local-chat',
        timeoutMs: 12_000,
        count: 2,
        promptTemplate: 'Expand {question} into {count} queries',
      },
    }), 'utf8')

    expect(loadQueryExpansionConfigFromEnv({ llm_wiki_config: configPath } as NodeJS.ProcessEnv)).toEqual({
      endpoint: 'http://127.0.0.1:9999/expand',
      model: 'local-chat',
      timeoutMs: 12_000,
      count: 2,
      promptTemplate: 'Expand {question} into {count} queries',
    })
    expect(() => loadQueryExpansionConfigFromEnv({
      llm_wiki_config: configPath,
      LLM_WIKI_EXPANSION_COUNT: '0',
    } as NodeJS.ProcessEnv)).toThrow(/Invalid LLM_WIKI_EXPANSION_COUNT: 0\. Must be a positive integer\./)
  })

  it('extracts LLM entity relationships during ingest and exposes key-value text to retrieval', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-entity-extract-'))
    tempRoots.push(knowledgeRoot)
    const sourcePath = path.join(knowledgeRoot, 'entity-source.md')
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(sourcePath, '# Connector Notes\n\nAlphaSystem integrates BetaEngine for routing decisions.\n', 'utf8')
    await writeFile(configPath, JSON.stringify({
      entityExtractionProvider: {
        endpoint: 'http://127.0.0.1:9999/entities',
        model: 'local-chat',
        maxRecords: 4,
        maxEntityRecords: 2,
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      const body = JSON.parse(String(init?.body ?? '{}')) as { title?: string; pageTarget?: string; maxRecords?: number; maxEntityRecords?: number }
      expect(target).toBe('http://127.0.0.1:9999/entities')
      expect(body.title).toBe('Connector Notes')
      expect(body.pageTarget).toBe('sources/connector-notes')
      expect(body.maxRecords).toBe(4)
      expect(body.maxEntityRecords).toBe(2)
      return new Response(JSON.stringify({
        entities: [
          { name: 'AlphaSystem', type: 'System', description: 'AlphaSystem provides a semantic bridge for vector-aware routing.' },
          { name: 'BetaEngine', type: 'System', description: 'BetaEngine receives routing decisions from AlphaSystem.' },
        ],
        relationships: [
          { source: 'AlphaSystem', target: 'BetaEngine', keywords: 'integration, routing', description: 'AlphaSystem integrates BetaEngine for routing decisions.' },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const ingest = await runCliFromArgv(['ingest', knowledgeRoot, sourcePath, '--extract-entities']) as Awaited<ReturnType<typeof runIngestCommand>>
    const extractionIndex = await loadEntityExtractionIndex(knowledgeRoot)
    const result = await retrieveChunks({ knowledgeRoot, question: 'semantic bridge vector aware', limit: 2 })

    expect(ingest.status).toBe('completed')
    expect(extractionIndex.records).toHaveLength(1)
    expect(extractionIndex.records[0]).toEqual(expect.objectContaining({
      pageTarget: 'sources/connector-notes',
      entities: expect.arrayContaining([
        expect.objectContaining({ name: 'AlphaSystem' }),
      ]),
      relationships: expect.arrayContaining([
        expect.objectContaining({ source: 'AlphaSystem', target: 'BetaEngine' }),
      ]),
    }))
    expect(result.mode).toBe('matched')
    expect(result.hits[0]!.chunk.pageTarget).toBe('sources/connector-notes')
    expect(result.hits[0]!.reasons).toEqual(expect.arrayContaining(['term:semantic', 'term:bridge', 'term:vector']))
  })

  it('loads entity extraction config from host-local config and rejects invalid limits', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-entity-config-'))
    tempRoots.push(configDir)
    const configPath = path.join(configDir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      entityExtractionProvider: {
        endpoint: 'http://127.0.0.1:9999/entities',
        model: 'local-chat',
        timeoutMs: 12_000,
        maxRecords: 8,
        maxEntityRecords: 4,
        maxInputChars: 5000,
        language: '中文',
        promptTemplate: 'Extract {maxRecords} records from {title}',
      },
    }), 'utf8')

    expect(loadEntityExtractionConfigFromEnv({ llm_wiki_config: configPath } as NodeJS.ProcessEnv)).toEqual({
      endpoint: 'http://127.0.0.1:9999/entities',
      model: 'local-chat',
      timeoutMs: 12_000,
      maxRecords: 8,
      maxEntityRecords: 4,
      maxInputChars: 5000,
      language: '中文',
      promptTemplate: 'Extract {maxRecords} records from {title}',
    })
    expect(() => loadEntityExtractionConfigFromEnv({
      llm_wiki_config: configPath,
      LLM_WIKI_ENTITY_MAX_RECORDS: '0',
    } as NodeJS.ProcessEnv)).toThrow(/Invalid LLM_WIKI_ENTITY_MAX_RECORDS: 0\. Must be a positive integer\./)
  })

  it('loads HyDE config from host-local config and rejects invalid timeout', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-hyde-config-'))
    tempRoots.push(configDir)
    const configPath = path.join(configDir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      hydeProvider: {
        endpoint: 'http://127.0.0.1:9999/hyde',
        model: 'local-chat',
        timeoutMs: 12_000,
        promptTemplate: 'Answer as a retrieval passage: {question}',
      },
    }), 'utf8')

    expect(loadHydeConfigFromEnv({ llm_wiki_config: configPath } as NodeJS.ProcessEnv)).toEqual({
      endpoint: 'http://127.0.0.1:9999/hyde',
      model: 'local-chat',
      timeoutMs: 12_000,
      promptTemplate: 'Answer as a retrieval passage: {question}',
    })
    expect(() => loadHydeConfigFromEnv({
      llm_wiki_config: configPath,
      LLM_WIKI_HYDE_TIMEOUT_MS: '0',
    } as NodeJS.ProcessEnv)).toThrow(/Invalid LLM_WIKI_HYDE_TIMEOUT_MS: 0\. Must be a positive integer\./)
  })
})

async function buildSampleIndex(prefix: string): Promise<string> {
  const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(knowledgeRoot)
  await runIngestCommand({
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
