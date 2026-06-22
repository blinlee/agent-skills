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

describe('retrieval ranking, graph boosts, rerank, and HyDE', () => {
  it('extracts ASCII retrieval terms from mixed Chinese/English questions', () => {
    expect(tokenize('主流给agent用的RAG方案是什么 embedding架构是怎样的')).toEqual(expect.arrayContaining(['agent', 'rag', 'embedding']))
  })

  it('caps embedding-only hybrid results below lexical hits and reports score parts', () => {
    const lexicalChunk = chunk({ chunkId: 'chunk-lexical', textSha256: 'lexical-hash', text: 'compiler notes lexical hit' })
    const embeddingChunk = chunk({ chunkId: 'chunk-embedding', textSha256: 'embedding-hash', text: 'semantic vector hit' })
    const results = scoreHybrid({
      chunks: [embeddingChunk, lexicalChunk],
      lexicalScores: new Map([[lexicalChunk.chunkId, { score: 1, terms: ['compiler'] }]]),
      embeddingRecords: new Map([[
        `local-http:bge-m3:${embeddingChunk.textSha256}`,
        {
          version: 1,
          provider: 'local-http',
          model: 'bge-m3',
          textSha256: embeddingChunk.textSha256,
          cacheKey: `local-http:bge-m3:${embeddingChunk.textSha256}`,
          chunkId: embeddingChunk.chunkId,
          pageTarget: embeddingChunk.pageTarget,
          dims: 2,
          vector: [1, 0],
          createdAt: '2026-06-12T00:00:00.000Z',
        },
      ]]),
      queryVector: [1, 0],
      providerConfig: providerConfig,
    })

    const lexical = results.find((entry) => entry.chunk.chunkId === lexicalChunk.chunkId)!
    const embeddingOnly = results.find((entry) => entry.chunk.chunkId === embeddingChunk.chunkId)!

    expect(results[0]!.chunk.chunkId).toBe(lexicalChunk.chunkId)
    expect(embeddingOnly.total).toBeLessThan(lexical.total)
    expect(embeddingOnly.reasons).toContain('diagnostic:embedding-only')
    expect(lexical).toEqual(expect.objectContaining({ lexical: expect.any(Number), embedding: expect.any(Number), metadata: expect.any(Number), total: expect.any(Number) }))
    expect(embeddingOnly).toEqual(expect.objectContaining({ lexical: expect.any(Number), embedding: expect.any(Number), metadata: expect.any(Number), total: expect.any(Number) }))
  })

  it('adds graph boost for resolved links and explains graph reasons without boosting missing links', () => {
    const seed = chunk({ chunkId: 'chunk-seed', textSha256: 'seed-hash', text: 'compiler notes lexical hit' })
    const linked = chunk({ chunkId: 'chunk-linked', textSha256: 'linked-hash', text: 'openclaw linked context' })
    const missing = chunk({ chunkId: 'chunk-missing', textSha256: 'missing-hash', text: 'missing link target' })
    linked.pageTarget = 'sources/linked'
    missing.pageTarget = 'sources/missing'
    const lexicalScores = new Map([[seed.chunkId, { score: 1, terms: ['compiler'] }]])
    const graphBoosts = scoreGraphBoosts({
      chunks: [seed, linked, missing],
      lexicalScores,
      graph: {
        links: [
          { from: seed.pageTarget, to: linked.pageTarget, status: 'resolved' },
          { from: seed.pageTarget, to: null, status: 'missing' },
        ],
        backlinks: {},
      },
    })

    const results = scoreHybrid({
      chunks: [seed, linked, missing],
      lexicalScores,
      embeddingRecords: new Map(),
      queryVector: null,
      providerConfig: null,
      graphBoosts,
    })
    const graphHit = results.find((entry) => entry.chunk.chunkId === linked.chunkId)!

    expect(graphHit.graph).toBeGreaterThan(0)
    expect(graphHit.reasons).toContain(`graph:outlink:${seed.pageTarget}`)
    expect(results.map((entry) => entry.chunk.chunkId)).not.toContain(missing.chunkId)
  })

  it('adds bounded second-hop graph boosts with lower weight', () => {
    const seed = chunk({ chunkId: 'chunk-seed-hop', textSha256: 'seed-hop-hash', text: 'compiler lexical seed' })
    const firstHop = chunk({ chunkId: 'chunk-first-hop', textSha256: 'first-hop-hash', text: 'first hop context' })
    const secondHop = chunk({ chunkId: 'chunk-second-hop', textSha256: 'second-hop-hash', text: 'second hop context' })
    firstHop.pageTarget = 'sources/first-hop'
    secondHop.pageTarget = 'sources/second-hop'
    const lexicalScores = new Map([[seed.chunkId, { score: 1, terms: ['compiler'] }]])
    const graphBoosts = scoreGraphBoosts({
      chunks: [seed, firstHop, secondHop],
      lexicalScores,
      graph: {
        links: [
          { from: seed.pageTarget, to: firstHop.pageTarget, status: 'resolved' },
          { from: firstHop.pageTarget, to: secondHop.pageTarget, status: 'resolved' },
        ],
        backlinks: {},
      },
    })

    const first = graphBoosts.get(firstHop.chunkId)!
    const second = graphBoosts.get(secondHop.chunkId)!

    expect(first.score).toBeGreaterThan(second.score)
    expect(second.reasons).toContain(`graph:second-hop-outlink:${firstHop.pageTarget}`)
  })

  it('boosts accepted taxonomy aliases without considering proposal queues', () => {
    const topic = chunk({ chunkId: 'chunk-topic', textSha256: 'topic-hash', text: 'canonical compiler design topic' })
    topic.pageTarget = 'concepts/compiler-design'
    topic.metadata.section = 'concepts'
    const unrelated = chunk({ chunkId: 'chunk-unrelated', textSha256: 'unrelated-hash', text: 'other concept' })
    unrelated.pageTarget = 'concepts/runtime-orchestration'
    unrelated.metadata.section = 'concepts'
    const taxonomyBoosts = scoreTaxonomyBoosts({
      chunks: [topic, unrelated],
      taxonomy: { topics: [], topicNodes: [], aliases: { compilers: 'compiler-design', parser: 'compiler-design' }, redirects: {}, categoryEdges: [] },
      queryTokens: ['how', 'do', 'compilers', 'work'],
    })
    const results = scoreHybrid({
      chunks: [topic, unrelated],
      lexicalScores: new Map(),
      embeddingRecords: new Map(),
      queryVector: null,
      providerConfig: null,
      taxonomyBoosts,
    })
    const taxonomyHit = results.find((entry) => entry.chunk.chunkId === topic.chunkId)!

    expect(taxonomyHit.taxonomy).toBeGreaterThan(0)
    expect(taxonomyHit.reasons).toContain('taxonomy:alias:compilers')
    expect(results.map((entry) => entry.chunk.chunkId)).not.toContain(unrelated.chunkId)
  })

  it('boosts topic node chunks with stable provenance', () => {
    const evidence = chunk({ chunkId: 'chunk-topic-node', textSha256: 'topic-node-hash', text: 'raw compiler evidence' })
    const taxonomyBoosts = scoreTaxonomyBoosts({
      chunks: [evidence],
      taxonomy: {
        topics: [{ slug: 'compiler-design', name: 'Compiler Design' }],
        topicNodes: [{
          slug: 'compiler-design',
          name: 'Compiler Design',
          aliases: [],
          redirectsFrom: [],
          relatedSlugs: [],
          chunkIds: ['chunk-topic-node'],
          pageTargets: ['concepts/compiler-design'],
          sourceRefs: ['raw/source.md'],
        }],
        aliases: {},
        redirects: {},
        categoryEdges: [],
      },
      queryTokens: ['compiler', 'design'],
    })
    const results = scoreHybrid({
      chunks: [evidence],
      lexicalScores: new Map(),
      embeddingRecords: new Map(),
      queryVector: null,
      providerConfig: null,
      taxonomyBoosts,
    })

    expect(results[0]?.chunk.chunkId).toBe('chunk-topic-node')
    expect(results[0]?.taxonomy).toBeGreaterThan(0)
    expect(results[0]?.reasons).toContain('taxonomy:topic:compiler-design')
  })

  it('boosts accepted taxonomy topic registry names directly', () => {
    const topic = chunk({ chunkId: 'chunk-topic-name', textSha256: 'topic-name-hash', text: 'compiler design concept' })
    topic.pageTarget = 'concepts/compiler-design'
    topic.metadata.section = 'concepts'
    const taxonomyBoosts = scoreTaxonomyBoosts({
      chunks: [topic],
      taxonomy: { topics: [{ slug: 'compiler-design', name: 'Compiler Design' }], topicNodes: [], aliases: {}, redirects: {}, categoryEdges: [] },
      queryTokens: ['compiler', 'design'],
    })
    const results = scoreHybrid({
      chunks: [topic],
      lexicalScores: new Map(),
      embeddingRecords: new Map(),
      queryVector: null,
      providerConfig: null,
      taxonomyBoosts,
    })

    expect(results[0]?.taxonomy).toBeGreaterThan(0)
    expect(results[0]?.reasons).toContain('taxonomy:topic:compiler-design')
  })

  it('boosts accepted taxonomy redirects and category graph neighbors', () => {
    const canonical = chunk({ chunkId: 'chunk-canonical', textSha256: 'canonical-hash', text: 'retrieval augmented generation' })
    canonical.pageTarget = 'concepts/retrieval-augmented-generation'
    canonical.metadata.section = 'concepts'
    const neighbor = chunk({ chunkId: 'chunk-neighbor', textSha256: 'neighbor-hash', text: 'hybrid retrieval' })
    neighbor.pageTarget = 'concepts/hybrid-retrieval'
    neighbor.metadata.section = 'concepts'
    const draft = chunk({ chunkId: 'chunk-draft', textSha256: 'draft-hash', text: 'draft proposal' })
    draft.pageTarget = 'concepts/unaccepted-proposal'
    draft.metadata.section = 'concepts'
    const taxonomyBoosts = scoreTaxonomyBoosts({
      chunks: [canonical, neighbor, draft],
      taxonomy: {
        topics: [],
        topicNodes: [],
        aliases: {},
        redirects: { rag: 'retrieval-augmented-generation' },
        categoryEdges: [
          { from: 'retrieval-augmented-generation', to: 'hybrid-retrieval', type: 'related' },
          { from: 'retrieval-augmented-generation', to: 'unaccepted-proposal', type: 'related', status: 'proposed' } as never,
        ],
      },
      queryTokens: ['rag'],
    })
    const results = scoreHybrid({
      chunks: [canonical, neighbor, draft],
      lexicalScores: new Map(),
      embeddingRecords: new Map(),
      queryVector: null,
      providerConfig: null,
      taxonomyBoosts,
    })

    expect(results.find((entry) => entry.chunk.chunkId === canonical.chunkId)?.reasons).toContain('taxonomy:redirect:rag')
    expect(results.find((entry) => entry.chunk.chunkId === neighbor.chunkId)?.reasons).toContain('taxonomy:edge:related:retrieval-augmented-generation->hybrid-retrieval')
    expect(results.map((entry) => entry.chunk.chunkId)).not.toContain(draft.chunkId)
  })

  it('reranks top hybrid candidates through a configured reranker', async () => {
    const first = chunk({ chunkId: 'chunk-first-rerank', textSha256: 'first-rerank-hash', text: 'compiler lexical first' })
    const second = chunk({ chunkId: 'chunk-second-rerank', textSha256: 'second-rerank-hash', text: 'compiler lexical second' })
    const entries = scoreHybrid({
      chunks: [first, second],
      lexicalScores: new Map([
        [first.chunkId, { score: 2, terms: ['compiler'] }],
        [second.chunkId, { score: 1, terms: ['compiler'] }],
      ]),
      embeddingRecords: new Map(),
      queryVector: null,
      providerConfig: null,
    })
    const diagnostics: string[] = []

    const reranked = await rerankHybridEntries({
      question: 'compiler',
      entries,
      limit: 2,
      diagnostics,
      config: {
        endpoint: 'http://reranker.local/rerank',
        model: 'bge-reranker-v2-m3',
        timeoutMs: 30_000,
        topN: 20,
      },
      reranker: {
        async rerank() {
          return new Map([
            [first.chunkId, 0.1],
            [second.chunkId, 0.9],
          ])
        },
      },
    })

    expect(reranked[0]!.chunk.chunkId).toBe(second.chunkId)
    expect(reranked[0]!.rerank).toBe(0.9)
    expect(reranked[0]!.reasons).toContain('rerank:score:0.900')
    expect(diagnostics).toContain('rerank applied to top 2 candidate(s)')
  })

  it('applies local HTTP rerank during retrieveChunks when endpoint is configured', async () => {
    stubNoEmbeddingProvider()
    vi.stubEnv('LLM_WIKI_RERANK_ENDPOINT', 'http://127.0.0.1:9999/rerank')
    vi.stubEnv('LLM_WIKI_RERANK_MODEL', 'bge-reranker-v2-m3')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ scores: [0.1, 0.99] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })))
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rerank-retrieval-'))
    tempRoots.push(knowledgeRoot)
    const first = chunk({ chunkId: 'chunk-http-first', textSha256: 'http-first-hash', text: 'compiler compiler lexical first' })
    const second = chunk({ chunkId: 'chunk-http-second', textSha256: 'http-second-hash', text: 'compiler lexical second with better passage' })
    const chunks = [first, second]
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

    const result = await retrieveChunks({ knowledgeRoot, question: 'compiler', limit: 2 })

    expect(result.mode).toBe('matched')
    expect(result.hits[0]!.chunk.chunkId).toBe(second.chunkId)
    expect(result.hits[0]!.score.rerank).toBe(0.99)
    expect(result.hits[0]!.reasons).toContain('rerank:score:0.990')
    expect(result.signalSummary.signalCounts.rerank).toBe(2)
    expect(result.diagnostics).toContain('rerank applied to top 2 candidate(s)')
  })

  it('rejects invalid rerank timeout config before any setTimeout can receive bad values', () => {
    vi.stubEnv('LLM_WIKI_RERANK_ENDPOINT', 'http://127.0.0.1:9999/rerank')
    vi.stubEnv('LLM_WIKI_RERANK_TIMEOUT_MS', '0')

    expect(() => loadRerankConfigFromEnv()).toThrow(/Invalid LLM_WIKI_RERANK_TIMEOUT_MS: 0\. Must be a positive integer\./)
  })

  it('applies HyDE text to embedding retrieval while lexical keeps the original question', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-hyde-retrieval-'))
    tempRoots.push(knowledgeRoot)
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
      hydeProvider: {
        endpoint: 'http://127.0.0.1:9999/hyde',
        model: 'local-chat',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)

    const semantic = chunk({ chunkId: 'chunk-hyde-semantic', textSha256: 'hyde-semantic-hash', text: 'semantic compiler pipeline answer' })
    const lexical = chunk({ chunkId: 'chunk-hyde-lexical', textSha256: 'hyde-lexical-hash', text: 'original question lexical anchor' })
    const chunks = [semantic, lexical]
    await mkdir(path.join(knowledgeRoot, 'system', 'index', 'embeddings', 'local-http-bge-m3'), { recursive: true })
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
    await writeEmbeddingCache(embeddingCachePath(knowledgeRoot, providerConfig), [
      {
        version: 1,
        provider: 'local-http',
        model: 'bge-m3',
        textSha256: semantic.textSha256,
        cacheKey: `local-http:bge-m3:${semantic.textSha256}`,
        chunkId: semantic.chunkId,
        pageTarget: semantic.pageTarget,
        dims: 2,
        vector: [1, 0],
        createdAt: '2026-06-18T00:00:00.000Z',
      },
      {
        version: 1,
        provider: 'local-http',
        model: 'bge-m3',
        textSha256: lexical.textSha256,
        cacheKey: `local-http:bge-m3:${lexical.textSha256}`,
        chunkId: lexical.chunkId,
        pageTarget: lexical.pageTarget,
        dims: 2,
        vector: [0, 1],
        createdAt: '2026-06-18T00:00:00.000Z',
      },
    ])

    const embeddedInputs: string[] = []
    const hydeInputs: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string; question?: string }
      if (target.endsWith('/hyde')) {
        hydeInputs.push(body.question ?? '')
        expect(body.question).toBe('original question lexical anchor')
        return new Response(JSON.stringify({ text: 'hypothetical compiler passage' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      embeddedInputs.push(body.input ?? '')
      return new Response(JSON.stringify({
        data: [{ embedding: body.input === 'hypothetical compiler passage' ? [1, 0] : [0, 1] }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const result = await retrieveChunks({ knowledgeRoot, question: 'original question lexical anchor', limit: 2 })

    expect(result.mode).toBe('matched')
    expect(embeddedInputs).toEqual(['hypothetical compiler passage'])
    expect(result.hits[0]!.chunk.chunkId).toBe(lexical.chunkId)
    expect(result.hits.map((hit) => hit.chunk.chunkId)).toContain(semantic.chunkId)
    expect(result.hits.find((hit) => hit.chunk.chunkId === semantic.chunkId)?.reasons).toEqual(expect.arrayContaining([
      'diagnostic:embedding-only',
      'embedding:cosine:1.000',
    ]))
    expect(hydeInputs).toEqual(['original question lexical anchor'])
    expect(result.diagnostics).toContain('hyde generated hypothetical document for embedding retrieval')

    embeddedInputs.length = 0
    hydeInputs.length = 0
    const disabled = await retrieveChunks({ knowledgeRoot, question: 'original question lexical anchor', limit: 2, disableHyde: true })

    expect(disabled.mode).toBe('matched')
    expect(hydeInputs).toEqual([])
    expect(embeddedInputs).toEqual(['original question lexical anchor'])
    expect(disabled.diagnostics).toContain('hyde disabled by query option; embedding raw question')
  })

  it('passes --no-hyde from the CLI query surface to retrieval', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-no-hyde-cli-')
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
      hydeProvider: {
        endpoint: 'http://127.0.0.1:9999/hyde',
        model: 'local-chat',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
      if (target.endsWith('/hyde')) {
        throw new Error('HyDE should be disabled')
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string }
      return new Response(JSON.stringify({ data: [{ embedding: vectorFor(body.input ?? '') }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const result = await runCliFromArgv(['query', knowledgeRoot, 'compiler', '--no-hyde']) as Awaited<ReturnType<typeof runCliFromArgv>> & {
      retrieval: { messages: string[] }
    }

    expect(result.retrieval.messages).toContain('hyde disabled by query option; embedding raw question')
  })

  it('falls back to lexical retrieval without env/cache and keeps complete citations', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await buildSampleIndex('llm-wiki-retrieval-lexical-')

    const result = await retrieveChunks({ knowledgeRoot, question: 'What is Compiler Notes?', limit: 2 })

    expect(result.mode).toBe('matched')
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.diagnostics).toContain('embedding provider not configured; using lexical retrieval only')
    expect(result.hits[0]!.citation).toEqual(expect.objectContaining({
      chunkId: expect.any(String),
      pageTarget: expect.any(String),
      startLine: expect.any(Number),
      endLine: expect.any(Number),
      sourceRef: expect.any(String),
      filePath: expect.any(String),
      excerpt: expect.any(String),
    }))
  })

  it('excludes review and proposal chunks by default but allows explicit internal includeReview', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-review-filter-'))
    tempRoots.push(knowledgeRoot)
    const normal = chunk({ chunkId: 'chunk-normal', textSha256: 'normal-hash', text: 'ordinary public evidence' })
    const review = chunk({ chunkId: 'chunk-review', textSha256: 'review-hash', text: 'secret proposal evidence' })
    review.pageTarget = 'review/queue/proposal'
    review.filePath = path.join(knowledgeRoot, 'review', 'queue', 'proposal.json')
    const chunks = [normal, review]
    await mkdir(path.join(knowledgeRoot, 'system', 'index'), { recursive: true })
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'chunks.json'), JSON.stringify({
      version: 2,
      schema: 'llm-wiki.chunks.v2',
      knowledgeRoot,
      generatedAt: '2026-06-12T00:00:00.000Z',
      chunks,
    }, null, 2), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'lexical.json'), JSON.stringify(buildLexicalIndex({
      knowledgeRoot,
      generatedAt: '2026-06-12T00:00:00.000Z',
      chunks,
    }), null, 2), 'utf8')

    const defaultResult = await retrieveChunks({ knowledgeRoot, question: 'secret proposal', limit: 3 })
    const explicitResult = await retrieveChunks({ knowledgeRoot, question: 'secret proposal', limit: 3, includeReview: true })

    expect(defaultResult.hits.map((hit) => hit.chunk.chunkId)).not.toContain('chunk-review')
    expect(defaultResult.diagnostics).toContain('review/proposal chunks excluded by default: 1')
    expect(explicitResult.hits.map((hit) => hit.chunk.chunkId)).toContain('chunk-review')
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
