import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runCliFromArgv,
  runBridgeAcceptCommand,
  runBridgeListCommand,
  runInitCommand,
  runIntakeCompleteCommand,
  runIntakeNextCommand,
  runIntakeParkCommand,
  runIntakeRejectCommand,
  runIntakeScanCommand,
  runIntakeStatusCommand,
  runIngestCommand,
  runEmbedIndexCommand,
  runProfileAcceptCommand,
  runProfileReviewCommand,
  runProfileSuggestCommand,
  runQueryRegistryCommand,
  runRegistryAddCommand,
  runRegistryInitCommand,
  runRegistryListCommand,
  runBridgeIndexCommand,
  runBuildIndexCommand,
  runRouteAcceptCommand,
  runRouteCommand,
  runRouteInboxCommand,
} from '../../src/cli.js'
import { runRegistryHybridRetrieval } from '../../src/retrieval/registry.js'
import type { Reranker } from '../../src/retrieval/rerank.js'
import { runIngestCommandWithCuration, runRouteAcceptCommandWithCuration, writeTestQualityPlan } from '../helpers/curation.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

async function writeSurveyInput(inputRoot: string, filename: string, content: string): Promise<string> {
  const sourcePath = path.join(inputRoot, filename)
  await writeFile(sourcePath, content, 'utf8')
  return sourcePath
}

function registrySemanticVectorFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (normalized.includes('量化')) {
    return [1, 0]
  }
  if (normalized.includes('quantitative research')) {
    return [0.95, 0.31225]
  }
  if (normalized.includes('financial time-series')) {
    return [0.72, 0.694]
  }
  if (normalized.includes('portfolio construction')) {
    return [0.55, 0.835]
  }
  if (normalized.includes('agent engineering') || normalized.includes('tool use') || normalized.includes('software systems')) {
    return [0.2, 0.98]
  }
  return [0, 1]
}

describe('multi-wiki registry query routing', () => {
  it('queries registered wikis and merges cited per-wiki answers', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    tempRoots.push(registryRoot, aiRoot)

    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: aiRoot,
      id: 'ai',
      title: 'AI Wiki',
      scope: ['openclaw', 'compiler', 'compilation', 'agent'],
    })
    const route = await runRouteCommand({
      registryRoot,
      source: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runRouteAcceptCommandWithCuration({ registryRoot, proposalId: route.proposal.id })
    await runBuildIndexCommand({ knowledgeRoot: aiRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(result.selectedWikis.map((wiki) => wiki.wikiId)).toContain('ai')
    expect(result.selectedWikis[0]).toEqual(expect.objectContaining({ chunkScore: expect.any(Number), calibratedScore: expect.any(Number) }))
    expect(result.results[0].result?.citations.length).toBeGreaterThan(0)
    expect(result.results[0].citationPack.length).toBeGreaterThan(0)
    expect(result.results[0].citationPack[0]).toEqual(expect.objectContaining({
      wikiId: 'ai',
      wikiTitle: 'AI Wiki',
      chunkId: expect.any(String),
      pageTarget: expect.any(String),
      score: expect.objectContaining({ total: expect.any(Number) }),
      reasons: expect.any(Array),
    }))
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.diagnostics).toEqual(expect.objectContaining({
      fusionPolicy: 'selectedCitationRank asc -> calibratedScore desc -> chunkScore desc -> profile score desc -> topEmbedding desc -> wikiId asc',
      citationCountBeforeDedupe: expect.any(Number),
      citationCountAfterDedupe: expect.any(Number),
      rawBackedCitationCountBeforeDedupe: expect.any(Number),
      derivedCitationCountBeforeDedupe: expect.any(Number),
      rawBackedCitationCountAfterDedupe: expect.any(Number),
      derivedCitationCountAfterDedupe: expect.any(Number),
      embeddingDegradedWikis: expect.any(Array),
      perWikiMetrics: expect.any(Array),
    }))
    expect(result.answer).toContain('AI Wiki')
    expect(result.answer).toContain('ai:sources/compiler-notes')
  })

  it('preserves expanded source passages in registry query output', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-source-pack-'))
    const wikiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-source-pack-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(registryRoot, wikiRoot, inputRoot)
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: wikiRoot,
      id: 'source-pack',
      title: 'Source Pack Wiki',
      scope: ['source context', 'retrieval passage'],
    })
    const sourcePath = path.join(inputRoot, 'registry-source-pack.md')
    const earlier = 'REGISTRY_EARLIER_CONTEXT gives setup before the central retrieval claim. '.repeat(8)
    const target = 'REGISTRY_TARGET_SIGNAL says registry output must preserve expanded source passages. '.repeat(5)
    const later = 'REGISTRY_LATER_CONTEXT gives the consequence after the central retrieval claim. '.repeat(8)
    await writeFile(sourcePath, `# Registry Source Pack\n\n## Evidence Section\n\n${earlier}\n\n${target}\n\n${later}\n`, 'utf8')
    await runIngestCommandWithCuration({
      knowledgeRoot: wikiRoot,
      input: sourcePath,
      qualityPath: await writeTestQualityPlan({
        sourcePath,
        baseDir: wikiRoot,
        quote: 'REGISTRYTARGETSIGNAL says registry output must preserve expanded source passages',
      }),
    })
    await runBuildIndexCommand({ knowledgeRoot: wikiRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'What does REGISTRY_TARGET_SIGNAL require registry output to preserve?',
    })
    const passage = result.sourceReadingPack.passages[0]!

    expect(result.agentReadingPack.answerability).toBe('answered')
    expect(passage).toEqual(expect.objectContaining({
      wikiId: 'source-pack',
      wikiTitle: 'Source Pack Wiki',
      rawPath: expect.stringContaining(`${path.sep}raw${path.sep}`),
    }))
    expect(passage.text).toContain('gives setup before the central retrieval claim')
    expect(passage.text).toContain('registry output must preserve expanded source passages')
    expect(passage.text).toContain('gives the consequence after the central retrieval claim')
    expect(passage.stitchedFromChunkIds.length).toBeGreaterThan(1)
  })

  it('routes mixed Chinese/ASCII RAG questions to the right registry wiki', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const decoyRoots = await Promise.all([1, 2, 3].map((index) => mkdtemp(path.join(os.tmpdir(), `llm-wiki-decoy-${index}-`))))
    const ragRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rag-'))
    const sourcePath = path.join(os.tmpdir(), `llm-wiki-rag-architecture-${Date.now()}.md`)
    tempRoots.push(registryRoot, ...decoyRoots, ragRoot, sourcePath)

    await runRegistryInitCommand({ registryRoot })
    for (const [index, root] of decoyRoots.entries()) {
      await runRegistryAddCommand({
        registryRoot,
        knowledgeRoot: root,
        id: `decoy-${index + 1}`,
        title: `Decoy ${index + 1}`,
        scope: [`unrelated domain ${index + 1}`],
      })
    }
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: ragRoot,
      id: 'rag-knowledge-graph',
      title: 'RAG & Knowledge Graph',
      scope: ['retrieval-augmented generation', 'GraphRAG', 'RAG', 'embedding architecture'],
    })
    await writeFile(
      sourcePath,
      '# llm-wiki RAG architecture\n\nAgent-facing RAG uses evidence-first hybrid retrieval: lexical chunks, local embedding vectors, graph and taxonomy boosts, and citation-grounded answers. The embedding architecture is optional and stores provider/model/text-hash vectors for each chunk.\n',
      'utf8',
    )
    await runIngestCommandWithCuration({ knowledgeRoot: ragRoot, input: sourcePath })
    await runBuildIndexCommand({ knowledgeRoot: ragRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '主流给agent用的RAG方案是什么 embedding架构是怎样的',
    })

    expect(result.selectedWikis[0].wikiId).toBe('rag-knowledge-graph')
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.agentReadingPack.answerability).toBe('answered')
  })

  it('searches all registered wikis before ranking so semantic evidence is not blocked by profile terms', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const profileRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-profile-decoy-'))
    const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-evidence-'))
    tempRoots.push(registryRoot, profileRoot, evidenceRoot)

    await runInitCommand({ knowledgeRoot: profileRoot })
    await runInitCommand({ knowledgeRoot: evidenceRoot })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: profileRoot,
      id: 'profile-decoy',
      title: 'Profile Decoy',
      scope: ['needle alpha quantum path'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: evidenceRoot,
      id: 'evidence-zero-profile',
      title: 'Evidence Wiki',
      scope: ['unrelated local notes'],
    })
    await writeFile(path.join(profileRoot, 'wiki', 'sources', 'decoy.md'), '# Decoy\n\nThis page does not contain the requested evidence.', 'utf8')
    await writeFile(path.join(profileRoot, 'wiki', 'index.md'), '- [[sources/decoy|Decoy]]\n', 'utf8')
    const evidenceSource = path.join(evidenceRoot, 'evidence-source.md')
    await writeFile(evidenceSource, '# Source\n\nThe needle alpha quantum path route belongs to the evidence wiki source text.', 'utf8')
    await runIngestCommandWithCuration({ knowledgeRoot: evidenceRoot, input: evidenceSource })
    await runBuildIndexCommand({ knowledgeRoot: profileRoot })
    await runBuildIndexCommand({ knowledgeRoot: evidenceRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'needle alpha quantum path',
    })

    expect(result.selectedWikis.map((wiki) => wiki.wikiId)).toContain('evidence-zero-profile')
    expect(result.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ wikiId: 'evidence-zero-profile', target: 'sources/source' }),
    ]))
    expect(result.agentReadingPack.answerability).toBe('answered')
  })

})
