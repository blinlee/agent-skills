import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBuildIndexCommand, runIngestCommand, runQueryCommand } from '../../src/cli.js'
import { buildEntityConceptGraphIndex, scoreEntityGraphBoosts } from '../../src/retrieval/entity-graph.js'
import { createEmbeddingProvider, diagnoseEmbeddingProviderConfig, loadEmbeddingProviderConfigFromEnv } from '../../src/retrieval/embedding-provider.js'
import type { ChunkIndexEntryV2 } from '../../src/retrieval/types.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('phase gaps: graph, claims, conflicts, provider matrix', () => {
  it('builds entity/concept graph index and bounded multi-hop retrieval reasons', () => {
    const seed = chunk({ chunkId: 'seed', pageTarget: 'sources/rag', pageTitle: 'RAG Retrieval', text: 'RAG retrieval uses Hybrid Search and citation chunks.' })
    const middle = chunk({ chunkId: 'middle', pageTarget: 'concepts/hybrid-search', pageTitle: 'Hybrid Search', text: 'Hybrid Search combines BM25 and vector search.' })
    const second = chunk({ chunkId: 'second', pageTarget: 'concepts/vector-search', pageTitle: 'Vector Search', text: 'Vector Search stores embedding vectors.' })
    const graph = buildEntityConceptGraphIndex({
      knowledgeRoot: '/tmp/wiki',
      generatedAt: '2026-06-13T00:00:00.000Z',
      chunks: [seed, middle, second],
      pageLinks: [
        { from: seed.pageTarget, to: middle.pageTarget, status: 'resolved' },
        { from: middle.pageTarget, to: second.pageTarget, status: 'resolved' },
      ],
    })

    expect(graph.schema).toBe('llm-wiki.entity-concept-graph.v1')
    expect(graph.nodes.some((node) => node.normalized.includes('hybrid-search'))).toBe(true)
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'page-link',
        chunkIds: expect.arrayContaining(['seed', 'middle']),
        pageTargets: expect.arrayContaining(['sources/rag', 'concepts/hybrid-search']),
        routingOnly: true,
      }),
    ]))

    const boosts = scoreEntityGraphBoosts({
      chunks: [seed, middle, second],
      graph,
      queryTokens: ['rag', 'retrieval'],
      lexicalScores: new Map([[seed.chunkId, { score: 1, terms: ['rag', 'retrieval'] }]]),
    })

    expect(boosts.get(middle.chunkId)?.reasons.join('\n')).toMatch(/entity-graph:1-hop/)
    expect(boosts.get(second.chunkId)?.reasons.join('\n')).toMatch(/entity-graph:2-hop/)
    expect(boosts.get(second.chunkId)?.reasons.join('\n')).toContain('2-hop')
  })

  it('writes entity-graph.json during index build', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-entity-graph-')
    const raw = await readFile(path.join(knowledgeRoot, 'system', 'index', 'entity-graph.json'), 'utf8')
    const graph = JSON.parse(raw) as { schema: string; nodes: unknown[]; edges: unknown[] }

    expect(graph.schema).toBe('llm-wiki.entity-concept-graph.v1')
    expect(graph.nodes.length).toBeGreaterThan(0)
  })

  it('returns heuristic claim mapping with confidence/reason and structured conflict table', async () => {
    const knowledgeRoot = await buildSampleIndex('llm-wiki-claims-conflicts-')
    const result = await runQueryCommand({ knowledgeRoot, question: 'Does Compiler Notes support deterministic compilation?' })

    expect(result.grounding.claims.length).toBeGreaterThan(0)
    expect(result.grounding.claims[0]).toEqual(expect.objectContaining({
      text: expect.any(String),
      supportingCitations: expect.any(Array),
      chunkIds: expect.any(Array),
      confidence: expect.any(Number),
      reason: expect.stringMatching(/query-token overlap|heuristic-overlap/),
    }))
    expect(result.grounding.conflicts.length).toBeGreaterThanOrEqual(0)
  })

  it('loads host-local embedding config when process env is not populated', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-host-config-'))
    tempRoots.push(configDir)
    const configPath = path.join(configDir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      defaultRoot: '/tmp/wiki',
      defaultRootKind: 'registry',
      embeddingProvider: {
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434/api/embed',
        model: 'bge-m3',
        dimensions: 1024,
        timeoutMs: 12000,
      },
    }), 'utf8')

    const config = loadEmbeddingProviderConfigFromEnv({ llm_wiki_config: configPath } as NodeJS.ProcessEnv)!

    expect(config).toEqual(expect.objectContaining({
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434/api/embed',
      model: 'bge-m3',
      dimensions: 1024,
      timeoutMs: 12000,
      format: 'ollama-embed',
      source: 'config',
      configPath,
    }))
  })

  it('ignores embedding provider env values and requires host-local config', async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-host-config-'))
    tempRoots.push(configDir)
    const configPath = path.join(configDir, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434/api/embed',
        model: 'bge-m3',
      },
    }), 'utf8')

    const config = loadEmbeddingProviderConfigFromEnv({
      llm_wiki_config: configPath,
      LLM_WIKI_EMBEDDING_MODEL: 'nomic-embed-text',
    } as NodeJS.ProcessEnv)!

    expect(config).toEqual(expect.objectContaining({
      provider: 'ollama',
      endpoint: 'http://127.0.0.1:11434/api/embed',
      model: 'bge-m3',
      source: 'config',
    }))
  })

  it('loads deterministic embedding provider matrix configs and parses mocked responses', async () => {
    const cases = [
      {
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434/api/embed',
        model: 'bge-m3',
        response: { embeddings: [[1, 2, 3]] },
        expectedFormat: 'ollama-embed',
      },
      {
        provider: 'lm-studio',
        endpoint: 'http://127.0.0.1:1234/v1/embeddings',
        model: 'text-embedding-model',
        response: { data: [{ embedding: [4, 5, 6] }] },
        expectedFormat: 'openai-compatible',
      },
      {
        provider: 'custom-endpoint',
        endpoint: 'http://127.0.0.1:9999/v1/embeddings',
        model: 'custom-local',
        format: 'openai-compatible',
        response: { data: [{ embedding: [7, 8, 9] }] },
        expectedFormat: 'openai-compatible',
      },
      {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:11434/api/embeddings',
        model: 'nomic-embed-text',
        response: { embedding: [10, 11, 12] },
        expectedFormat: undefined,
      },
    ] as const

    for (const testCase of cases) {
      const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-host-config-'))
      tempRoots.push(configDir)
      const configPath = path.join(configDir, 'config.json')
      await writeFile(configPath, JSON.stringify({
        embeddingProvider: {
          provider: testCase.provider,
          endpoint: testCase.endpoint,
          model: testCase.model,
          dimensions: 3,
          ...('format' in testCase ? { format: testCase.format } : {}),
        },
      }), 'utf8')

      const config = loadEmbeddingProviderConfigFromEnv({ llm_wiki_config: configPath } as NodeJS.ProcessEnv)!
      const diagnostic = diagnoseEmbeddingProviderConfig(config)!
      expect(diagnostic.provider).toBe(testCase.provider)
      expect(diagnostic.ready).toBe(true)
      if (testCase.expectedFormat) expect(diagnostic.format).toBe(testCase.expectedFormat)
      expect(diagnostic.diagnostics.join('\n')).toMatch(/wire format|timeout ms/)

      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(testCase.response), { status: 200 })))
      const vector = await createEmbeddingProvider(config).embed({ text: 'hello' })
      expect(vector).toHaveLength(3)
    }
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

function chunk(input: { chunkId: string; pageTarget: string; pageTitle: string; text: string }): ChunkIndexEntryV2 {
  return {
    version: 2,
    id: input.chunkId,
    chunkId: input.chunkId,
    pageTarget: input.pageTarget,
    pageTitle: input.pageTitle,
    filePath: `/tmp/${input.chunkId}.md`,
    sourceRef: 'fixture',
    heading: input.pageTitle,
    headingPath: [input.pageTitle],
    level: 1,
    startLine: 1,
    endLine: 5,
    anchor: input.chunkId,
    text: input.text,
    textSha256: `${input.chunkId}-hash`,
    tokenCountApprox: 8,
    links: [],
    metadata: {
      docType: input.pageTarget.startsWith('concepts/') ? 'concept' : 'source',
      section: input.pageTarget.startsWith('concepts/') ? 'concepts' : 'sources',
      slug: input.pageTarget.split('/').pop()!,
    },
  }
}
