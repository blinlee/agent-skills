import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runBuildIndexCommand,
  runEmbedIndexCommand,
  runInitCommand,
  runQueryRegistryCommand,
  runRegistryAddCommand,
  runRouteCommand,
} from '../../src/cli.js'
import { runRegistryHybridRetrieval } from '../../src/retrieval/registry.js'
import type { Reranker } from '../../src/retrieval/rerank.js'
import { runIngestCommandWithCuration, runRouteAcceptCommandWithCuration } from '../helpers/curation.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('registry query document mode, rerank, and pack diagnostics', () => {
  it('returns distinct original documents for survey-style registry questions', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-survey-'))
    const financeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-finance-survey-'))
    const decoyRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-agent-survey-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-survey-inputs-'))
    const configPath = path.join(registryRoot, 'embedding-config.json')
    tempRoots.push(registryRoot, financeRoot, decoyRoot, inputRoot)
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/v1/embeddings',
        model: 'registry-survey-test',
        format: 'openai-compatible',
      },
    }), 'utf8')

    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: financeRoot,
      id: 'ai-finance',
      title: 'AI Finance',
      scope: ['financial foundation models', 'quantitative finance modeling', 'portfolio construction'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: decoyRoot,
      id: 'ai-agent-engineering',
      title: 'AI Agent Engineering',
      scope: ['LLM agents', 'agent engineering', 'multi-agent systems'],
    })

    const sources = [
      ['ai-quant-frameworks.md', '# AI Quantitative Research Frameworks\n\nAI-based quantitative research has several route families: factor discovery, financial time-series foundation models, portfolio construction, execution optimization, and risk control.'],
      ['financial-foundation-models.md', '# Financial Foundation Models\n\nFinancial time-series foundation models learn market representations for return forecasting, regime detection, cross-asset signals, and downstream quantitative research workflows.'],
      ['portfolio-construction.md', '# Portfolio Construction Route\n\nPortfolio construction connects alpha signals to allocation, risk control, transaction cost modeling, and execution optimization in AI-based quantitative research.'],
    ] as const
    for (const [filename, content] of sources) {
      await runIngestCommandWithCuration({ knowledgeRoot: financeRoot, input: await writeSurveyInput(inputRoot, filename, content) })
    }
    await runIngestCommandWithCuration({
      knowledgeRoot: decoyRoot,
      input: await writeSurveyInput(
        inputRoot,
        'agent-engineering.md',
        '# Agent Engineering Notes\n\nGeneral agent engineering discusses tool use, prompt workflows, task decomposition, evaluation harnesses, and team automation for software systems.',
      ),
    })
    await runBuildIndexCommand({ knowledgeRoot: financeRoot })
    await runBuildIndexCommand({ knowledgeRoot: decoyRoot })
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] }
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
      return new Response(JSON.stringify({
        data: inputs.map((input, index) => ({ index, embedding: registrySemanticVectorFor(String(input)) })),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    await runEmbedIndexCommand({ knowledgeRoot: financeRoot })
    await runEmbedIndexCommand({ knowledgeRoot: decoyRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '基于AI的量化研究现在主要框架是怎样的，哪几种路线？',
      readingMode: 'document',
    })

    expect(result.agentReadingPack.answerability).toBe('answered')
    expect(result.sourceReadingPack.readingMode).toBe('document')
    const documents = result.sourceReadingPack.documents ?? []
    const documentKeys = new Set(documents.map((document) => document.rawPath ?? document.sourceRef))
    expect(documents.length).toBeGreaterThanOrEqual(2)
    expect(documentKeys.size).toBe(documents.length)
    expect(documents.every((document) => document.wikiId === 'ai-finance')).toBe(true)
    expect(result.sourceReadingPack.passages.every((passage) => passage.wikiId === 'ai-finance')).toBe(true)
    const text = result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')
    expect(text).toContain('AI-based quantitative research')
    expect(text).toContain('Financial time-series foundation models')
    expect(text).not.toContain('General agent engineering')
  })

  it('uses semantic strength and query intent before wiki id for embedding-only registry ties', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-tie-'))
    const financeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-finance-tie-'))
    const decoyRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-agent-tie-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-tie-'))
    const configPath = path.join(registryRoot, 'embedding-config.json')
    tempRoots.push(registryRoot, financeRoot, decoyRoot, inputRoot)
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/v1/embeddings',
        model: 'registry-semantic-tie-test',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] }
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
      return new Response(JSON.stringify({
        data: inputs.map((input, index) => ({ index, embedding: registryTieVectorFor(String(input)) })),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: financeRoot,
      id: 'ai-finance',
      title: 'AI Finance',
      scope: ['financial foundation models', 'quantitative finance modeling'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: decoyRoot,
      id: 'ai-agent-engineering',
      title: 'AI Agent Engineering',
      scope: ['LLM agents', 'agent engineering', 'multi-agent systems'],
    })

    const financeSource = path.join(inputRoot, 'alpha-jungle.md')
    const decoySource = path.join(inputRoot, 'agent-engineering.md')
    await writeFile(financeSource, [
      '# Navigating the Alpha Jungle',
      '',
      'Formulaic factor mining studies alpha discovery, portfolio evaluation, trading signals, and financial time-series evidence.',
    ].join('\n'), 'utf8')
    await writeFile(decoySource, [
      '# AI Software Engineering Notes',
      '',
      'AI software engineering discusses coding agents, tool use, task decomposition, prompt workflows, and evaluation harnesses.',
    ].join('\n'), 'utf8')
    await runIngestCommandWithCuration({ knowledgeRoot: financeRoot, input: financeSource })
    await runIngestCommandWithCuration({ knowledgeRoot: decoyRoot, input: decoySource })
    await runBuildIndexCommand({ knowledgeRoot: financeRoot })
    await runBuildIndexCommand({ knowledgeRoot: decoyRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '基于AI的量化研究现在主要框架是怎样的，哪几种路线？',
      readingMode: 'document',
    })

    expect(result.selectedWikis[0]).toEqual(expect.objectContaining({ wikiId: 'ai-finance' }))
    expect(result.results.find((entry) => entry.wikiId === 'ai-finance')!.chunkScore).toBe(0.2)
    expect(result.results.find((entry) => entry.wikiId === 'ai-agent-engineering')!.chunkScore).toBe(0.2)
    expect(result.sourceReadingPack.answerability).toBe('answered')
    expect(result.sourceReadingPack.passages.length).toBeGreaterThan(0)
    expect(result.sourceReadingPack.passages.every((passage) => passage.wikiId === 'ai-finance')).toBe(true)
    expect(result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')).toContain('Formulaic factor mining')
    expect(result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')).not.toContain('AI software engineering')
  })

  it('reranks source-backed citations across wikis before building the default source reading pack', async () => {
    const alphaRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-alpha-rerank-'))
    const betaRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-beta-rerank-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rerank-inputs-'))
    tempRoots.push(alphaRoot, betaRoot, inputRoot)

    const alphaSource = path.join(inputRoot, 'alpha.md')
    const betaSource = path.join(inputRoot, 'beta.md')
    await writeFile(alphaSource, [
      '# Alpha Candidate',
      '',
      'Registry rerank candidate explains a generic ordinary route.',
    ].join('\n'), 'utf8')
    await writeFile(betaSource, [
      '# Beta Candidate',
      '',
      'Registry rerank candidate includes the preferred result marker and should be ranked first by reranker.',
    ].join('\n'), 'utf8')

    await runIngestCommandWithCuration({ knowledgeRoot: alphaRoot, input: alphaSource })
    await runIngestCommandWithCuration({ knowledgeRoot: betaRoot, input: betaSource })
    await runBuildIndexCommand({ knowledgeRoot: alphaRoot })
    await runBuildIndexCommand({ knowledgeRoot: betaRoot })

    const rerankedTexts: string[] = []
    const reranker: Reranker = {
      async rerank({ candidates }) {
        for (const candidate of candidates) {
          rerankedTexts.push(candidate.text)
        }
        return new Map(candidates.map((candidate) => [
          candidate.chunkId,
          candidate.text.includes('preferred result marker') ? 0.95 : 0.05,
        ]))
      },
    }

    const result = await runRegistryHybridRetrieval({
      question: 'registry rerank candidate',
      selectedWikis: [
        { wikiId: 'alpha', title: 'Alpha Wiki', knowledgeRoot: alphaRoot, score: 0.5, matchedTerms: [] },
        { wikiId: 'beta', title: 'Beta Wiki', knowledgeRoot: betaRoot, score: 0.5, matchedTerms: [] },
      ],
      citationBudget: 2,
      maxCitationsPerWiki: 1,
      rerankConfig: { endpoint: 'test://registry-rerank', model: null, timeoutMs: 30_000, topN: 10 },
      reranker,
    })

    expect(rerankedTexts.join('\n')).toContain('preferred result marker')
    expect(result.diagnostics.registryRerankDiagnostics).toContain('registry rerank applied to top 2 candidate(s)')
    expect(result.citations[0]).toEqual(expect.objectContaining({
      wikiId: 'beta',
      score: expect.objectContaining({ rerank: 0.95 }),
      reasons: expect.arrayContaining(['registry-rerank:score:0.950']),
    }))
    expect(result.sourceReadingPack.passages[0]).toEqual(expect.objectContaining({
      wikiId: 'beta',
      text: expect.stringContaining('preferred result marker'),
    }))
  })

  it('keeps registry query usable when registry rerank is unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rerank-fallback-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-rerank-fallback-inputs-'))
    tempRoots.push(root, inputRoot)

    const source = path.join(inputRoot, 'fallback.md')
    await writeFile(source, [
      '# Rerank Fallback',
      '',
      'Registry rerank fallback evidence remains available when the optional reranker is down.',
    ].join('\n'), 'utf8')
    await runIngestCommandWithCuration({ knowledgeRoot: root, input: source })
    await runBuildIndexCommand({ knowledgeRoot: root })

    const reranker: Reranker = {
      async rerank() {
        throw new Error('reranker offline')
      },
    }

    const result = await runRegistryHybridRetrieval({
      question: 'registry rerank fallback evidence',
      selectedWikis: [
        { wikiId: 'fallback', title: 'Fallback Wiki', knowledgeRoot: root, score: 0.5, matchedTerms: [] },
      ],
      citationBudget: 2,
      maxCitationsPerWiki: 1,
      rerankConfig: { endpoint: 'test://registry-rerank', model: null, timeoutMs: 30_000, topN: 10 },
      reranker,
    })

    expect(result.diagnostics.registryRerankDiagnostics.join('\n')).toContain('registry rerank unavailable')
    expect(result.agentReadingPack.answerability).toBe('answered')
    expect(result.sourceReadingPack.passages[0]!.text).toContain('optional reranker is down')
  })

  it('does not turn weak registry citations into an answer when grounding says evidence is insufficient', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const weakRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-weak-'))
    tempRoots.push(registryRoot, weakRoot)

    await runInitCommand({ knowledgeRoot: weakRoot })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: weakRoot,
      id: 'weak',
      title: 'Weak Wiki',
      scope: ['quantum cradle'],
    })
    await writeFile(path.join(weakRoot, 'wiki', 'sources', 'weak.md'), '# Weak Note\n\nQuantum cradle appears in a wiki-derived note without raw source backing.', 'utf8')
    await writeFile(path.join(weakRoot, 'wiki', 'index.md'), '- [[sources/weak|Weak Note]]\n', 'utf8')
    await runBuildIndexCommand({ knowledgeRoot: weakRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'quantum cradle',
    })

    expect(result.results[0].citationPack.length).toBeGreaterThan(0)
    expect(result.results[0].result?.grounding.answerability).toBe('insufficient-evidence')
    expect(result.diagnostics.perWikiMetrics[0]).toEqual(expect.objectContaining({
      wikiId: 'weak',
      status: 'insufficient-evidence',
    }))
    expect(result.agentReadingPack.answerability).toBe('insufficient-evidence')
    expect(result.citations).toHaveLength(0)
    expect(result.sourceReadingPack).toEqual(expect.objectContaining({
      answerability: 'insufficient-evidence',
      passageCount: 0,
      passages: [],
    }))
    expect(result.diagnostics.derivedCitationCountBeforeDedupe).toBeGreaterThan(0)
    expect(result.diagnostics.derivedCitationCountAfterDedupe).toBe(0)
    expect(result.answer).toContain('did not find enough source-backed evidence')
    expect(result.answer).not.toContain('## Weak Wiki')
  })

  it('keeps private chunks out of registry citation packs and redacts registry query output', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    tempRoots.push(registryRoot, aiRoot)

    await runInitCommand({ knowledgeRoot: aiRoot })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: aiRoot,
      id: 'ai',
      title: 'AI Wiki',
      scope: ['retrieval', 'secret', 'citation', 'rag'],
    })
    const sourceDir = path.join(aiRoot, 'wiki', 'sources')
    await writeFile(path.join(sourceDir, 'public-rag.md'), [
      '---',
      'title: "Public RAG Note"',
      'created: "2026-06-13"',
      'updated: "2026-06-13"',
      'type: "source"',
      'tags: ["rag"]',
      'sources: ["fixture"]',
      '---',
      '# Public RAG Note',
      '',
      'Public registry retrieval evidence says citation packs should stay auditable.',
    ].join('\n'), 'utf8')
    await writeFile(path.join(sourceDir, 'private-rag.md'), [
      '---',
      'title: "Private RAG Secret"',
      'created: "2026-06-13"',
      'updated: "2026-06-13"',
      'type: "source"',
      'tags: ["rag"]',
      'sources: ["fixture"]',
      'privacy: "private"',
      '---',
      '# Private RAG Secret',
      '',
      'PRIVATE_TOKEN_XYZ is private registry retrieval evidence and must not enter cross-wiki citation packs.',
    ].join('\n'), 'utf8')
    await writeFile(
      path.join(aiRoot, 'wiki', 'index.md'),
      '# Wiki 索引\n\n- [[sources/public-rag|Public RAG Note]]\n- [[sources/private-rag|Private RAG Secret]]\n',
      'utf8',
    )
    await runBuildIndexCommand({ knowledgeRoot: aiRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'What says private registry retrieval evidence PRIVATE_TOKEN_XYZ?',
    })

    expect(result.question).toContain('[REDACTED]')
    expect(result.answer).toContain('[REDACTED]')
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN_XYZ')
    expect(result.results[0].retrievalDiagnostics).toEqual(expect.arrayContaining([
      expect.stringMatching(/private\/sensitive chunks excluded by default: 1/),
    ]))
    expect(result.citations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'sources/private-rag' }),
    ]))
  })

  it('deduplicates and diversifies cross-wiki registry citation packs', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    const compilerRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-compiler-'))
    tempRoots.push(registryRoot, aiRoot, compilerRoot)

    for (const wiki of [
      { root: aiRoot, id: 'ai', title: 'AI Wiki' },
      { root: compilerRoot, id: 'compiler', title: 'Compiler Wiki' },
    ]) {
      await runRegistryAddCommand({
        registryRoot,
        knowledgeRoot: wiki.root,
        id: wiki.id,
        title: wiki.title,
        scope: ['openclaw', 'compiler', 'compilation', 'agent', 'deterministic pipeline'],
      })
      const source = path.join(wiki.root, `${wiki.id}-sample.md`)
      await writeFile(source, await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'), 'utf8'), 'utf8')
      const route = await runRouteCommand({
        registryRoot,
        source,
      })
      await runRouteAcceptCommandWithCuration({ registryRoot, proposalId: route.proposal.id, wikiId: wiki.id })
      await runBuildIndexCommand({ knowledgeRoot: wiki.root })
    }

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(result.results.map((entry) => entry.wikiId).sort()).toEqual(['ai', 'compiler'])
    expect(new Set(result.citations.map((citation) => citation.wikiId)).size).toBeGreaterThan(1)
    expect(result.diagnostics.citationCountAfterDedupe).toBeLessThanOrEqual(result.diagnostics.citationCountBeforeDedupe)
    expect(result.diagnostics.citationBudget).toBe(8)
    expect(result.diagnostics.maxCitationsPerWiki).toBe(3)
    expect(result.diagnostics.maxConcurrentWikis).toBe(4)
    expect(result.agentReadingPack).toEqual(expect.objectContaining({
      answerability: 'answered',
      retrievalMode: 'registry-hybrid',
      citationCount: result.citations.length,
      mustReadFurther: true,
    }))
    expect(result.agentReadingPack.searchedWikis.map((wiki) => wiki.wikiId).sort()).toEqual(['ai', 'compiler'])
    expect(result.agentReadingPack.citationsToRead[0]).toEqual(expect.objectContaining({
      citationIndex: 1,
      wikiId: expect.any(String),
      filePath: expect.any(String),
    }))
  })

  it('honors registry query budgets for citations and concurrency diagnostics', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    const compilerRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-compiler-'))
    tempRoots.push(registryRoot, aiRoot, compilerRoot)

    for (const wiki of [
      { root: aiRoot, id: 'ai', title: 'AI Wiki' },
      { root: compilerRoot, id: 'compiler', title: 'Compiler Wiki' },
    ]) {
      await runRegistryAddCommand({
        registryRoot,
        knowledgeRoot: wiki.root,
        id: wiki.id,
        title: wiki.title,
        scope: ['openclaw', 'compiler', 'compilation', 'agent', 'deterministic pipeline'],
      })
      const source = path.join(wiki.root, `${wiki.id}-sample.md`)
      await writeFile(source, await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'), 'utf8'), 'utf8')
      const route = await runRouteCommand({ registryRoot, source })
      await runRouteAcceptCommandWithCuration({ registryRoot, proposalId: route.proposal.id, wikiId: wiki.id })
      await runBuildIndexCommand({ knowledgeRoot: wiki.root })
    }

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'What is deterministic across the knowledge pipeline?',
      citationBudget: 2,
      maxCitationsPerWiki: 1,
      maxConcurrentWikis: 1,
    })

    expect(result.citations.length).toBeLessThanOrEqual(2)
    expect(result.diagnostics.citationBudget).toBe(2)
    expect(result.diagnostics.maxCitationsPerWiki).toBe(1)
    expect(result.diagnostics.maxConcurrentWikis).toBe(1)
    expect(result.diagnostics.fusionPolicy).toBe('selectedCitationRank asc -> calibratedScore desc -> chunkScore desc -> profile score desc -> topEmbedding desc -> wikiId asc')
    expect(result.diagnostics.averageDurationMs).toEqual(expect.any(Number))
    expect(result.diagnostics.perWikiMetrics).toHaveLength(2)
    expect(result.diagnostics.perWikiMetrics[0]).toEqual(expect.objectContaining({
      wikiId: expect.any(String),
      status: expect.stringMatching(/answered|insufficient-evidence|no-match|stale-index|embedding-degraded|error/),
      profileScore: expect.any(Number),
      chunkScore: expect.any(Number),
      calibratedScore: expect.any(Number),
      citationCount: expect.any(Number),
    }))
    expect(result.selectedWikis[0]).toEqual(expect.objectContaining({
      calibratedScore: expect.any(Number),
    }))
  })
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

function registryTieVectorFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (normalized.includes('量化')) {
    return [1, 0]
  }
  if (
    normalized.includes('alpha jungle')
    || normalized.includes('formulaic factor')
    || normalized.includes('portfolio evaluation')
    || normalized.includes('financial time-series')
  ) {
    return [0.6, 0.8]
  }
  if (
    normalized.includes('ai software engineering')
    || normalized.includes('coding agents')
    || normalized.includes('prompt workflows')
  ) {
    return [0.58, 0.814616]
  }
  return [0, 1]
}
