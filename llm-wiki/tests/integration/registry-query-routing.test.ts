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

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

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
    await runRouteAcceptCommand({ registryRoot, proposalId: route.proposal.id })
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
    await runIngestCommand({ knowledgeRoot: wikiRoot, input: sourcePath })
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
    await runIngestCommand({ knowledgeRoot: ragRoot, input: sourcePath })
    await runBuildIndexCommand({ knowledgeRoot: ragRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '主流给agent用的RAG方案是什么 embedding架构是怎样的',
    })

    expect(result.selectedWikis[0].wikiId).toBe('rag-knowledge-graph')
    expect(result.citations.length).toBeGreaterThan(0)
    expect(result.agentReadingPack.answerability).toBe('answered')
  })

  it('keeps unrelated domains out of the default pack for technical RAG questions', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-domain-gate-'))
    const ragRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-domain-rag-'))
    const financeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-domain-finance-'))
    const perceptionRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-domain-perception-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-domain-inputs-'))
    tempRoots.push(registryRoot, ragRoot, financeRoot, perceptionRoot, inputRoot)

    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: ragRoot,
      id: 'rag-knowledge-graph',
      title: 'RAG & Knowledge Graph',
      scope: ['RAG', 'GraphRAG', 'LightRAG', 'embedding architecture'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: financeRoot,
      id: 'ai-finance',
      title: 'AI Finance',
      scope: ['AI finance', 'quantitative research', 'financial foundation models'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: perceptionRoot,
      id: 'embodied-3d-perception',
      title: 'Embodied 3D Perception',
      scope: ['3D perception', 'sensor fusion', 'scene understanding'],
    })

    await runIngestCommand({
      knowledgeRoot: ragRoot,
      input: await writeSurveyInput(
        inputRoot,
        'lightrag-query-modes.md',
        '# LightRAG Query Modes\n\nLightRAG RAG architecture combines hybrid retrieval, entity graph context, chunk embeddings, and rerank context before returning source passages.',
      ),
    })
    await runIngestCommand({
      knowledgeRoot: financeRoot,
      input: await writeSurveyInput(
        inputRoot,
        'financial-architecture.md',
        '# Financial Foundation Models\n\nFinancial time-series models discuss AI architecture, forecasting workflows, market factors, and portfolio research methods.',
      ),
    })
    await runIngestCommand({
      knowledgeRoot: perceptionRoot,
      input: await writeSurveyInput(
        inputRoot,
        'sensor-fusion-architecture.md',
        '# Sensor Fusion Architecture\n\n3D perception architecture uses LiDAR, camera calibration, point clouds, and scene understanding for embodied robotics.',
      ),
    })
    await runBuildIndexCommand({ knowledgeRoot: ragRoot })
    await runBuildIndexCommand({ knowledgeRoot: financeRoot })
    await runBuildIndexCommand({ knowledgeRoot: perceptionRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '主流给agent用的RAG方案是什么 embedding架构是怎样的',
    })

    expect(result.sourceReadingPack.readingMode).toBe('passage')
    expect(result.agentReadingPack.answerability).toBe('answered')
    expect(result.results.map((entry) => entry.wikiId)).toEqual(expect.arrayContaining([
      'rag-knowledge-graph',
      'ai-finance',
      'embodied-3d-perception',
    ]))
    expect(result.sourceReadingPack.passages.length).toBeGreaterThan(0)
    expect(result.sourceReadingPack.passages.every((passage) => passage.wikiId === 'rag-knowledge-graph')).toBe(true)
    const text = result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')
    expect(text).toContain('LightRAG RAG architecture')
    expect(text).not.toContain('Financial time-series models')
    expect(text).not.toContain('3D perception architecture')
  })

  it('keeps generic agent, automation, and perception warning cases domain-clean', async () => {
    const cases = [
      {
        id: 'openclaw-hooks',
        question: 'OpenClaw 的 hooks 和自动化任务应该怎么管理？',
        targetWikiId: 'openclaw-automation',
        targetTitle: 'OpenClaw Automation',
        targetScope: ['OpenClaw', 'hooks', 'automation task', 'runtime state'],
        targetFile: 'openclaw-hooks.md',
        targetText: '# OpenClaw Hooks\n\nOpenClaw hooks manage runtime state, approval gates, session recovery, root config, and automation tasks for agent workflows.',
        decoys: [
          ['ai-finance', 'AI Finance', ['AI finance', 'workflow'], 'Finance workflow notes', 'AI finance workflow notes discuss portfolio evaluation and market risk automation.'],
          ['rag-knowledge-graph', 'RAG & Knowledge Graph', ['RAG', 'workflow'], 'RAG workflow notes', 'RAG workflow notes discuss chunks, embeddings, and graph context.'],
        ],
      },
      {
        id: 'agent-tool-eval',
        question: 'AI agent 工具调用和评测框架怎么设计？',
        targetWikiId: 'ai-agent-engineering',
        targetTitle: 'AI Agent Engineering',
        targetScope: ['agent engineering', 'tool calling', 'evaluation harness'],
        targetFile: 'agent-tool-eval.md',
        targetText: '# Agent Tool Evaluation\n\nAI agent engineering needs tool calling contracts, evaluation harnesses, task decomposition, context engineering, and coding-agent workflow checks.',
        decoys: [
          ['embodied-3d-perception', 'Embodied 3D Perception', ['agent', 'evaluation'], 'Robot agent benchmark', 'Robot manipulation agents are evaluated with camera, LiDAR, point cloud, and 3D scene benchmarks.'],
          ['ai-finance', 'AI Finance', ['AI evaluation'], 'Finance evaluation notes', 'Financial model evaluation studies portfolio return, factor risk, and trading signal quality.'],
        ],
      },
      {
        id: 'perception-sensor-fusion',
        question: '3D具身感知里传感器融合主要怎么做？有哪些路线？',
        targetWikiId: 'embodied-3d-perception',
        targetTitle: 'Embodied 3D Perception',
        targetScope: ['3D perception', 'sensor fusion', 'LiDAR camera calibration'],
        targetFile: 'sensor-fusion-routes.md',
        targetText: '# Sensor Fusion Routes\n\n3D具身感知的传感器融合路线包括 LiDAR-camera calibration, point cloud alignment, multimodal scene understanding, and robot perception grounding.',
        decoys: [
          ['rag-knowledge-graph', 'RAG & Knowledge Graph', ['3D graph', 'fusion'], 'Graph fusion notes', 'GraphRAG fusion combines retrieval context, graph communities, chunks, and embeddings.'],
          ['ai-finance', 'AI Finance', ['AI routes'], 'Finance route notes', 'AI finance routes include factor discovery, portfolio construction, forecasting, and trading evaluation.'],
        ],
      },
    ] as const

    for (const testCase of cases) {
      const registryRoot = await mkdtemp(path.join(os.tmpdir(), `llm-wiki-${testCase.id}-registry-`))
      const targetRoot = await mkdtemp(path.join(os.tmpdir(), `llm-wiki-${testCase.id}-target-`))
      const inputRoot = await mkdtemp(path.join(os.tmpdir(), `llm-wiki-${testCase.id}-inputs-`))
      tempRoots.push(registryRoot, targetRoot, inputRoot)

      await runRegistryAddCommand({
        registryRoot,
        knowledgeRoot: targetRoot,
        id: testCase.targetWikiId,
        title: testCase.targetTitle,
        scope: [...testCase.targetScope],
      })
      await runIngestCommand({
        knowledgeRoot: targetRoot,
        input: await writeSurveyInput(inputRoot, testCase.targetFile, testCase.targetText),
      })
      await runBuildIndexCommand({ knowledgeRoot: targetRoot })

      for (const [wikiId, title, scope, sourceTitle, sourceBody] of testCase.decoys) {
        const decoyRoot = await mkdtemp(path.join(os.tmpdir(), `llm-wiki-${testCase.id}-${wikiId}-`))
        tempRoots.push(decoyRoot)
        await runRegistryAddCommand({
          registryRoot,
          knowledgeRoot: decoyRoot,
          id: wikiId,
          title,
          scope: [...scope],
        })
        await runIngestCommand({
          knowledgeRoot: decoyRoot,
          input: await writeSurveyInput(inputRoot, `${wikiId}.md`, `# ${sourceTitle}\n\n${sourceBody}`),
        })
        await runBuildIndexCommand({ knowledgeRoot: decoyRoot })
      }

      const result = await runQueryRegistryCommand({
        registryRoot,
        question: testCase.question,
      })

      expect(result.agentReadingPack.answerability, testCase.id).toBe('answered')
      expect(result.sourceReadingPack.passages.length, testCase.id).toBeGreaterThan(0)
      expect(result.sourceReadingPack.passages.every((passage) => passage.wikiId === testCase.targetWikiId), testCase.id).toBe(true)
      const text = result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')
      expect(text, testCase.id).toContain(testCase.targetText.split('\n\n')[1]!.slice(0, 32))
      for (const [, , , , sourceBody] of testCase.decoys) {
        expect(text, testCase.id).not.toContain(sourceBody.slice(0, 32))
      }
    }
  })

  it('keeps short generic registry questions from pulling every wiki through one shared term', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-generic-agent-registry-'))
    const agentRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-generic-agent-'))
    const robotRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-generic-robot-'))
    const financeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-generic-finance-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-generic-inputs-'))
    tempRoots.push(registryRoot, agentRoot, robotRoot, financeRoot, inputRoot)

    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: agentRoot,
      id: 'ai-agent-engineering',
      title: 'AI Agent Engineering',
      scope: ['agent engineering', 'tool calling', 'evaluation harness'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: robotRoot,
      id: 'embodied-3d-perception',
      title: 'Embodied 3D Perception',
      scope: ['robot perception', '3D scene understanding'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: financeRoot,
      id: 'ai-finance',
      title: 'AI Finance',
      scope: ['financial factor mining', 'trading agent'],
    })

    await runIngestCommand({
      knowledgeRoot: agentRoot,
      input: await writeSurveyInput(
        inputRoot,
        'agent-engineering.md',
        '# Agent Engineering\n\nAn AI agent is a software system that uses tools, context, planning, and evaluation harnesses to complete tasks.',
      ),
    })
    await runIngestCommand({
      knowledgeRoot: robotRoot,
      input: await writeSurveyInput(
        inputRoot,
        'robot-agent.md',
        '# Robot Agent Notes\n\nA robot agent appears in embodied perception benchmarks with cameras, LiDAR, and manipulation scenes.',
      ),
    })
    await runIngestCommand({
      knowledgeRoot: financeRoot,
      input: await writeSurveyInput(
        inputRoot,
        'trading-agent.md',
        '# Trading Agent Notes\n\nA trading agent appears in factor mining workflows for market signals and portfolio decisions.',
      ),
    })
    await runBuildIndexCommand({ knowledgeRoot: agentRoot })
    await runBuildIndexCommand({ knowledgeRoot: robotRoot })
    await runBuildIndexCommand({ knowledgeRoot: financeRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'agent 是什么？',
    })

    expect(result.agentReadingPack.answerability).toBe('answered')
    expect(result.sourceReadingPack.passages.length).toBeGreaterThan(0)
    expect(result.sourceReadingPack.passages.every((passage) => passage.wikiId === 'ai-agent-engineering')).toBe(true)
    const text = result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')
    expect(text).toContain('software system that uses tools')
    expect(text).not.toContain('embodied perception benchmarks')
    expect(text).not.toContain('factor mining workflows')
  })

  it('keeps unreadable table fragments out of the default registry source pack', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-readable-registry-'))
    const ragRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-readable-rag-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-readable-inputs-'))
    tempRoots.push(registryRoot, ragRoot, inputRoot)

    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: ragRoot,
      id: 'rag-knowledge-graph',
      title: 'RAG & Knowledge Graph',
      scope: ['LightRAG', 'GraphRAG', 'graph retrieval'],
    })
    await runIngestCommand({
      knowledgeRoot: ragRoot,
      input: await writeSurveyInput(
        inputRoot,
        'rag-table-fragment.md',
        '# RAG Table Fragment\n\n<td>GraphRAG</td><td>LightRAG</td><td>58.4%</td><td>GraphRAG</td><td>LightRAG</td><td>73.6%</td>',
      ),
    })
    await runIngestCommand({
      knowledgeRoot: ragRoot,
      input: await writeSurveyInput(
        inputRoot,
        'rag-readable.md',
        '# RAG Readable Comparison\n\nLightRAG and GraphRAG both use graph-based retrieval mechanisms, but the readable comparison explains their retrieval structure, context construction, and response generation differences.',
      ),
    })
    await runBuildIndexCommand({ knowledgeRoot: ragRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'LightRAG 和 GraphRAG 的区别是什么？',
    })

    expect(result.agentReadingPack.answerability).toBe('answered')
    const text = result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')
    expect(text).toContain('readable comparison explains')
    expect(text).not.toContain('<td>GraphRAG</td>')
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
    await runIngestCommand({ knowledgeRoot: evidenceRoot, input: evidenceSource })
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

  it('keeps weak cross-wiki semantic noise out of the default source reading pack', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-noise-'))
    const financeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-finance-'))
    const decoyRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-decoy-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    const configPath = path.join(registryRoot, 'embedding-config.json')
    tempRoots.push(registryRoot, financeRoot, decoyRoot, inputRoot)
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/v1/embeddings',
        model: 'registry-semantic-test',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string | string[] }
      const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
      return new Response(JSON.stringify({
        data: inputs.map((input, index) => ({ index, embedding: registrySemanticVectorFor(String(input)) })),
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

    const financeSource = path.join(inputRoot, 'ai-quant-frameworks.md')
    const decoySource = path.join(inputRoot, 'agent-engineering.md')
    await writeFile(financeSource, [
      '# AI Quantitative Research Frameworks',
      '',
      'AI-based quantitative research is organized around factor discovery, financial time-series forecasting, agentic research assistants, portfolio construction, execution optimization, and risk control.',
    ].join('\n'), 'utf8')
    await writeFile(decoySource, [
      '# Agent Engineering Notes',
      '',
      'General agent engineering discusses tool use, prompt workflows, task decomposition, evaluation harnesses, and team automation for software systems.',
    ].join('\n'), 'utf8')
    await runIngestCommand({ knowledgeRoot: financeRoot, input: financeSource })
    await runIngestCommand({ knowledgeRoot: decoyRoot, input: decoySource })
    await runBuildIndexCommand({ knowledgeRoot: financeRoot })
    await runBuildIndexCommand({ knowledgeRoot: decoyRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '基于AI的量化研究现在主要框架是怎样的，哪几种路线？',
    })

    expect(result.results.map((entry) => entry.wikiId)).toEqual(expect.arrayContaining(['ai-finance', 'ai-agent-engineering']))
    expect(result.results.find((entry) => entry.wikiId === 'ai-agent-engineering')!.citationPack.length).toBeGreaterThan(0)
    expect(result.agentReadingPack.answerability).toBe('answered')
    expect(result.sourceReadingPack.passages.length).toBeGreaterThan(0)
    expect(result.sourceReadingPack.passages.every((passage) => passage.wikiId === 'ai-finance')).toBe(true)
    expect(result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')).toContain('AI-based quantitative research')
    expect(result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')).not.toContain('General agent engineering')
  })

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
      await runIngestCommand({ knowledgeRoot: financeRoot, input: await writeSurveyInput(inputRoot, filename, content) })
    }
    await runIngestCommand({
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
    await runIngestCommand({ knowledgeRoot: financeRoot, input: financeSource })
    await runIngestCommand({ knowledgeRoot: decoyRoot, input: decoySource })
    await runBuildIndexCommand({ knowledgeRoot: financeRoot })
    await runBuildIndexCommand({ knowledgeRoot: decoyRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '基于AI的量化研究现在主要框架是怎样的，哪几种路线？',
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

    await runIngestCommand({ knowledgeRoot: alphaRoot, input: alphaSource })
    await runIngestCommand({ knowledgeRoot: betaRoot, input: betaSource })
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
    await runIngestCommand({ knowledgeRoot: root, input: source })
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
      await runRouteAcceptCommand({ registryRoot, proposalId: route.proposal.id, wikiId: wiki.id })
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
      await runRouteAcceptCommand({ registryRoot, proposalId: route.proposal.id, wikiId: wiki.id })
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

async function stubEmbeddingProvider(configPath: string): Promise<void> {
  await writeFile(configPath, JSON.stringify({
    embeddingProvider: {
      provider: 'local-http',
      endpoint: 'http://127.0.0.1:9999/v1/embeddings',
      model: 'test-embed',
      format: 'openai-compatible',
      timeoutMs: 30_000,
    },
  }), 'utf8')
  vi.stubEnv('llm_wiki_config', configPath)
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { input?: string | string[] }
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
    return new Response(JSON.stringify({
      data: inputs.map((input, index) => ({ index, embedding: vectorFor(String(input)) })),
    }), { status: 200 })
  }))
}

function vectorFor(text: string): number[] {
  return [text.length % 17 + 1, text.charCodeAt(0) % 11 + 1]
}

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
