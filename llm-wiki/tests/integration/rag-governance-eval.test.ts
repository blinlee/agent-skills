import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBuildIndexCommand, runInitCommand, runQueryCommand } from '../../src/cli.js'
import { embeddingCachePath, loadEmbeddingCache, makeEmbeddingRecord, textSha256, writeEmbeddingCache } from '../../src/retrieval/embedding-cache.js'
import { createEmbeddingProvider, loadEmbeddingProviderConfigFromEnv } from '../../src/retrieval/embedding-provider.js'
import { runRegistryHybridRetrieval } from '../../src/retrieval/registry.js'
import { retrieveChunks } from '../../src/retrieval/retrieval.js'
import type { EmbeddingProviderConfig } from '../../src/retrieval/embedding-types.js'
import type { ChunkIndexEntryV2 } from '../../src/retrieval/types.js'

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
] as const

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('RAG governance eval pack', () => {
  it('uses richer link/backlink/topic/entity/concept graph signals for bounded retrieval without missing or ambiguous boost', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await buildGraphEvalWiki()

    const result = await retrieveChunks({ knowledgeRoot, question: 'How does alpha retrieval use beta bridge?', limit: 8 })
    const byTarget = new Map(result.hits.map((hit) => [hit.chunk.pageTarget, hit]))

    expect(result.mode).toBe('matched')
    expect(byTarget.get('sources/beta-bridge')?.reasons).toContain('metadata:source')
    expect([...byTarget.keys()]).not.toContain('concepts/gamma-evidence')
    expect([...byTarget.keys()]).not.toContain('sources/missing-target')
    expect(byTarget.get('entities/ambiguous-target')?.reasons ?? []).not.toContain('graph:outlink:sources/alpha-retrieval')
    expect(byTarget.get('concepts/ambiguous-target')?.reasons ?? []).not.toContain('graph:outlink:sources/alpha-retrieval')
  })

  it('exposes graph-ranked context packs for cited entity and concept nodes', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await buildGraphEvalWiki()

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'How does alpha retrieval use beta bridge and gamma evidence?',
    })

    expect(answer.agentReadingPack.contextLayers.graphContext.length).toBeGreaterThan(0)
    expect(answer.agentReadingPack.contextLayers.graphContext).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: expect.stringMatching(/Alpha Retrieval|Beta Bridge|Gamma Evidence/i),
        connectedNodes: expect.arrayContaining([
          expect.objectContaining({
            label: expect.any(String),
            edgeKind: expect.stringMatching(/page-link|cooccurs|topic-related|llm-relation/),
            chunkIds: expect.any(Array),
            pageTargets: expect.any(Array),
            routingOnly: expect.any(Boolean),
          }),
        ]),
      }),
    ]))
  })

  it('maps grounded claims to citation indexes, chunk ids, confidence, and reasons instead of uncited hard answers', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await buildClaimConflictWiki()

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What does claim atlas say about evidence mapping?',
    })

    expect(answer.grounding.answerability).toBe('answered')
    expect(answer.grounding.claims.length).toBeGreaterThan(0)
    for (const claim of answer.grounding.claims) {
      expect(claim.citationIndexes.length).toBeGreaterThan(0)
      expect(claim.chunkIds.length).toBeGreaterThan(0)
      expect(claim.confidence).toBeGreaterThan(0)
      expect(['strong', 'partial', 'weak']).toContain(claim.supportLevel)
      expect(claim.citationCoverage).toBeGreaterThan(0)
      expect(claim.validation).toEqual(expect.objectContaining({
        status: expect.stringMatching(/supported/),
        supportLevel: claim.supportLevel,
      }))
      expect(claim.matchedTerms.length).toBeGreaterThan(0)
      expect(claim.reason).toMatch(/chunk-level citation|query-token overlap|lines/)
      for (const citationIndex of claim.citationIndexes) {
        expect(answer.citations[citationIndex - 1]).toBeTruthy()
      }
    }
    expect(answer.answer).toMatch(/\[1\]/)
  })

  it('emits structured conflict diagnostics with target, chunk, and evidence pair for conflict/stale/uncertain/contradictory evidence', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await buildClaimConflictWiki()

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'claim atlas conflict stale uncertain contradictory evidence mapping',
    })
    const kinds = new Set(answer.grounding.conflicts.map((signal) => signal.kind))

    expect(kinds.has('conflict') || kinds.has('contradictory')).toBe(true)
    expect(answer.grounding.conflicts.length).toBeGreaterThanOrEqual(1)
    expect(answer.grounding.contradictionTable.length).toBeGreaterThanOrEqual(1)
    expect(answer.grounding.contradictionTable[0]).toEqual(expect.objectContaining({
      issueId: expect.stringMatching(/^contradiction-/),
      summary: expect.any(String),
      recommendation: expect.any(String),
      evidence: expect.any(Array),
    }))
    for (const signal of answer.grounding.conflicts) {
      expect(signal.target).toMatch(/^sources\//)
      expect(signal.chunkId).toMatch(/^sha256:/)
      expect(signal.evidencePair[0]).toEqual(expect.objectContaining({ target: signal.target, chunkId: signal.chunkId }))
      if (answer.citations.length > 1) {
        expect(signal.evidencePair[1]).toEqual(expect.objectContaining({ target: expect.any(String), excerpt: expect.any(String) }))
      }
      expect(signal.reason).toMatch(/evidence/)
      expect(signal.matchedText).toBeTruthy()
    }
    expect(answer.answer).toMatch(/人工复核/)
    expect(answer.answer).toMatch(/contradiction-1/)
  })

  it('covers local-http embedding provider matrix: Ollama-like, LM Studio-like, custom format, dimension mismatch, and empty cache', async () => {
    const knowledgeRoot = await buildEmbeddingWiki()
    const chunkState = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'index', 'chunks.json'), 'utf8')) as { chunks: ChunkIndexEntryV2[] }
    const firstChunk = chunkState.chunks[0]!

    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>
      if (url.endsWith('/v1/embeddings')) {
        const input = body.input
        const inputs = Array.isArray(input) ? input : [input]
        return new Response(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [0, 0, index + 1] })) }), { status: 200 })
      }
      if ('prompt' in body) return new Response(JSON.stringify({ embedding: [0, 1, 0] }), { status: 200 })
      if ('input' in body) {
        const input = body.input
        const inputs = Array.isArray(input) ? input : [input]
        return new Response(JSON.stringify({ embeddings: inputs.map((_, index) => [index + 1, 0, 0]) }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: [{ embedding: [0, 0, 1] }] }), { status: 200 })
    }))

    expect(await createEmbeddingProvider(config('http://127.0.0.1:11434/api/embed', 'ollama-embed')).embed({ text: 'q' })).toEqual([1, 0, 0])
    expect(await createEmbeddingProvider(config('http://127.0.0.1:11434/api/embeddings', 'ollama-embeddings')).embed({ text: 'q' })).toEqual([0, 1, 0])
    expect(await createEmbeddingProvider(config('http://127.0.0.1:1234/v1/embeddings', 'openai-compatible')).embed({ text: 'q' })).toEqual([0, 0, 1])
    expect(await createEmbeddingProvider(config('http://127.0.0.1:11434/api/embed', 'ollama-embed')).embedBatch?.([{ text: 'a' }, { text: 'b' }])).toEqual([[1, 0, 0], [2, 0, 0]])
    expect(await createEmbeddingProvider(config('http://127.0.0.1:1234/v1/embeddings', 'openai-compatible')).embedBatch?.([{ text: 'a' }, { text: 'b' }])).toEqual([[0, 0, 1], [0, 0, 2]])
    await expect(createEmbeddingProvider({ ...config('http://127.0.0.1:11434/api/embed', 'ollama-embed'), dimensions: 2 }).embed({ text: 'q' })).rejects.toThrow(/dimensions mismatch/i)

    const configPath = await writeEmbeddingTestConfig({
      provider: 'local-http',
      endpoint: 'http://127.0.0.1:11434/api/embed',
      model: 'bge-m3',
      format: 'ollama-embed',
    })
    vi.stubEnv('llm_wiki_config', configPath)
    let result = await retrieveChunks({ knowledgeRoot, question: 'embedding matrix sentinel', limit: 2 })
    expect(result.diagnostics).toContain('embedding cache missing or empty; using lexical retrieval only')

    const cachePath = embeddingCachePath(knowledgeRoot, config('http://127.0.0.1:11434/api/embed', 'ollama-embed'))
    await writeEmbeddingCache(cachePath, [makeEmbeddingRecord({
      provider: 'local-http',
      model: 'bge-m3',
      textSha256: firstChunk.textSha256,
      chunkId: firstChunk.chunkId,
      pageTarget: firstChunk.pageTarget,
      vector: [1, 0, 0],
      createdAt: '2026-06-13T00:00:00.000Z',
    })])
    const cache = await loadEmbeddingCache(cachePath)
    expect(cache.records).toHaveLength(1)
    result = await retrieveChunks({ knowledgeRoot, question: 'semantic-only query', limit: 2 })
    expect(result.signalSummary.signalCounts.embedding).toBeGreaterThan(0)
  })

  it('keeps private/sensitive/review/proposal chunks out of default query and registry citations', async () => {
    stubNoEmbeddingProvider()
    const knowledgeRoot = await buildPrivacyWiki()

    const queryAnswer = await runQueryCommand({ knowledgeRoot, question: 'privacy sentinel review proposal secret evidence', includeReview: false })
    expect(JSON.stringify(queryAnswer)).not.toContain('PRIVATE_SENTINEL')
    expect(queryAnswer.citations.map((citation) => citation.target)).toContain('sources/public-privacy')
    expect(queryAnswer.citations.map((citation) => citation.target)).not.toEqual(expect.arrayContaining([
      'sources/private-privacy',
      'sources/sensitive-privacy',
      'review/queue/privacy-review',
      'taxonomy/proposals/privacy-proposal',
    ]))
    expect(queryAnswer.retrieval.messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/private\/sensitive chunks excluded by default/),
    ]))

    const registryAnswer = await runRegistryHybridRetrieval({
      question: 'privacy sentinel review proposal secret evidence',
      selectedWikis: [{ wikiId: 'privacy', title: 'Privacy Wiki', knowledgeRoot, score: 1, matchedTerms: ['privacy'] }],
    })
    expect(JSON.stringify(registryAnswer)).not.toContain('PRIVATE_SENTINEL')
    expect(registryAnswer.citations).toHaveLength(0)
    expect(registryAnswer.sourceReadingPack.passages).toHaveLength(0)
    expect(registryAnswer.diagnostics.derivedCitationCountBeforeDedupe).toBeGreaterThan(0)
    expect(registryAnswer.diagnostics.derivedCitationCountAfterDedupe).toBe(0)
    const perWikiTargets = registryAnswer.results.flatMap((entry) => entry.citationPack.map((citation) => citation.target))
    expect(perWikiTargets).toContain('sources/public-privacy')
    expect(perWikiTargets).not.toContain('review/queue/privacy-review')
    expect(perWikiTargets).not.toContain('taxonomy/proposals/privacy-proposal')
  })

  it('rejects unsupported embedding providers and invalid config before retrieval uses them', async () => {
    let configPath = await writeEmbeddingTestConfig({
      provider: 'remote-cloud',
      endpoint: 'http://127.0.0.1:11434/api/embed',
      model: 'bge-m3',
    })
    vi.stubEnv('llm_wiki_config', configPath)
    expect(() => loadEmbeddingProviderConfigFromEnv()).toThrow(/Unsupported LLM_WIKI_EMBEDDING_PROVIDER/)

    configPath = await writeEmbeddingTestConfig({
      provider: 'local-http',
      endpoint: 'http://127.0.0.1:11434/api/embed',
      model: 'bge-m3',
      dimensions: 'not-a-number',
    })
    vi.stubEnv('llm_wiki_config', configPath)
    expect(() => loadEmbeddingProviderConfigFromEnv()).toThrow(/Invalid embeddingProvider\.dimensions/)
  })
})

async function buildGraphEvalWiki(): Promise<string> {
  const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-graph-eval-'))
  tempRoots.push(knowledgeRoot)
  await runInitCommand({ knowledgeRoot })
  await writeWikiPage(knowledgeRoot, 'sources', 'alpha-retrieval', 'Alpha Retrieval', 'Alpha retrieval uses beta bridge for bounded multi-hop retrieval. It mentions gamma evidence and missing target without relying on ambiguous links.\n\n[[sources/beta-bridge|Beta Bridge]] [[missing-target|Missing Target]] [[ambiguous-target|Ambiguous Target]]')
  await writeWikiPage(knowledgeRoot, 'sources', 'beta-bridge', 'Beta Bridge', 'Beta bridge links retrieval evidence to gamma evidence.\n\n[[concepts/gamma-evidence|Gamma Evidence]] [[sources/alpha-retrieval|Alpha Retrieval]]')
  await writeWikiPage(knowledgeRoot, 'concepts', 'gamma-evidence', 'Gamma Evidence', 'Gamma evidence is a concept node for bounded graph retrieval and has stable topic provenance.')
  await writeWikiPage(knowledgeRoot, 'entities', 'delta-node', 'Delta Node', 'Delta node is an entity connected through the accepted category graph.')
  await writeWikiPage(knowledgeRoot, 'entities', 'ambiguous-target', 'Ambiguous Target Entity', 'First ambiguous page should not be graph boosted by a bare ambiguous link.')
  await writeWikiPage(knowledgeRoot, 'concepts', 'ambiguous-target', 'Ambiguous Target Concept', 'Second ambiguous page should not be graph boosted by a bare ambiguous link.')
  await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '# Wiki 索引\n\n- [[sources/alpha-retrieval|Alpha Retrieval]]\n- [[sources/beta-bridge|Beta Bridge]]\n- [[concepts/gamma-evidence|Gamma Evidence]]\n- [[entities/delta-node|Delta Node]]\n- [[entities/ambiguous-target|Ambiguous Target Entity]]\n- [[concepts/ambiguous-target|Ambiguous Target Concept]]\n', 'utf8')
  await writeTaxonomy(knowledgeRoot)
  await runBuildIndexCommand({ knowledgeRoot })
  return knowledgeRoot
}

async function buildClaimConflictWiki(): Promise<string> {
  const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-claim-conflict-'))
  tempRoots.push(knowledgeRoot)
  await runInitCommand({ knowledgeRoot })
  await writeWikiPage(knowledgeRoot, 'sources', 'claim-atlas', 'Claim Atlas', 'Claim atlas says evidence mapping requires citation indexes, chunk ids, confidence values, and explicit reasons. Grounded claims cannot be emitted without supporting citation spans.')
  await writeWikiPage(knowledgeRoot, 'sources', 'claim-conflict', 'Claim Conflict', 'Claim atlas has conflict evidence: the older mapping conflicts with newer chunk-level implementation evidence. This note is outdated and stale. It is uncertain whether prior answers have complete confidence fields.')
  await writeWikiPage(knowledgeRoot, 'sources', 'claim-contradiction', 'Claim Contradiction', 'Contradictory evidence says page-level-only claims are no longer acceptable for claim atlas diagnostics.')
  await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '# Wiki 索引\n\n- [[sources/claim-atlas|Claim Atlas]]\n- [[sources/claim-conflict|Claim Conflict]]\n- [[sources/claim-contradiction|Claim Contradiction]]\n', 'utf8')
  await runBuildIndexCommand({ knowledgeRoot })
  return knowledgeRoot
}

async function buildEmbeddingWiki(): Promise<string> {
  const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-embedding-matrix-'))
  tempRoots.push(knowledgeRoot)
  await runInitCommand({ knowledgeRoot })
  await writeWikiPage(knowledgeRoot, 'sources', 'embedding-matrix', 'Embedding Matrix', 'Embedding matrix sentinel validates provider formats, cache parsing, and deterministic fallback behavior.')
  await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '# Wiki 索引\n\n- [[sources/embedding-matrix|Embedding Matrix]]\n', 'utf8')
  await runBuildIndexCommand({ knowledgeRoot })
  return knowledgeRoot
}

async function buildPrivacyWiki(): Promise<string> {
  const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-privacy-eval-'))
  tempRoots.push(knowledgeRoot)
  await runInitCommand({ knowledgeRoot })
  await writeWikiPage(knowledgeRoot, 'sources', 'public-privacy', 'Public Privacy', 'Public privacy sentinel evidence is safe for query and registry citations.')
  await writeWikiPage(knowledgeRoot, 'sources', 'private-privacy', 'Private Privacy', 'PRIVATE_SENTINEL private retrieval secret evidence must not enter citations.', ['privacy: "private"'])
  await writeWikiPage(knowledgeRoot, 'sources', 'sensitive-privacy', 'Sensitive Privacy', 'Sensitive proposal secret evidence must not enter citations.', ['sensitive: true'])
  await writeWikiPage(knowledgeRoot, 'review/queue', 'privacy-review', 'Privacy Review', 'Review proposal secret evidence must not enter default citations.')
  await writeWikiPage(knowledgeRoot, 'taxonomy/proposals', 'privacy-proposal', 'Privacy Proposal', 'Taxonomy proposal secret evidence must not enter default citations.')
  await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '# Wiki 索引\n\n- [[sources/public-privacy|Public Privacy]]\n- [[sources/private-privacy|Private Privacy]]\n- [[sources/sensitive-privacy|Sensitive Privacy]]\n- [[review/queue/privacy-review|Privacy Review]]\n- [[taxonomy/proposals/privacy-proposal|Privacy Proposal]]\n', 'utf8')
  await runBuildIndexCommand({ knowledgeRoot })
  return knowledgeRoot
}

async function writeWikiPage(knowledgeRoot: string, section: string, slug: string, title: string, body: string, extraFrontmatter: string[] = []): Promise<void> {
  const dir = section.startsWith('review/') || section.startsWith('taxonomy/')
    ? path.join(knowledgeRoot, section)
    : path.join(knowledgeRoot, 'wiki', section)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${slug}.md`), [
    '---',
    `title: "${title}"`,
    'created: "2026-06-13"',
    'updated: "2026-06-13"',
    section.startsWith('sources') ? 'type: "source"' : 'type: "concept"',
    'tags: ["eval"]',
    'sources: ["fixture"]',
    ...extraFrontmatter,
    '---',
    `# ${title}`,
    '',
    '## Summary',
    body,
    '',
  ].join('\n'), 'utf8')
}

async function writeTaxonomy(knowledgeRoot: string): Promise<void> {
  await mkdir(path.join(knowledgeRoot, 'taxonomy'), { recursive: true })
  await writeFile(path.join(knowledgeRoot, 'taxonomy', 'topic-registry.json'), JSON.stringify({
    topics: [{ slug: 'gamma-evidence', name: 'Gamma Evidence' }],
  }, null, 2), 'utf8')
  await writeFile(path.join(knowledgeRoot, 'taxonomy', 'aliases.json'), JSON.stringify({ aliases: { gamma: 'gamma-evidence' } }, null, 2), 'utf8')
  await writeFile(path.join(knowledgeRoot, 'taxonomy', 'category-graph.json'), JSON.stringify({
    edges: [{ from: 'gamma-evidence', to: 'delta-node', type: 'related', status: 'accepted' }],
  }, null, 2), 'utf8')
}

function config(endpoint: string, format: EmbeddingProviderConfig['format']): EmbeddingProviderConfig {
  return { provider: 'local-http', endpoint, model: 'bge-m3', timeoutMs: 30_000, format }
}

function stubNoEmbeddingProvider(): void {
  for (const key of embeddingEnvKeys) {
    vi.stubEnv(key, '')
  }
  vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `llm-wiki-empty-config-${Date.now()}-${Math.random()}.json`))
}

async function writeEmbeddingTestConfig(embeddingProvider: Record<string, unknown>): Promise<string> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-embedding-config-'))
  tempRoots.push(configDir)
  const configPath = path.join(configDir, 'config.json')
  await writeFile(configPath, JSON.stringify({ embeddingProvider }), 'utf8')
  return configPath
}
