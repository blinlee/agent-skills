import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runBuildIndexCommand,
  runQueryRegistryCommand,
  runRegistryAddCommand,
} from '../../src/cli.js'
import { runIngestCommandWithCuration } from '../helpers/curation.js'

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

describe('registry query domain gates and noise filtering', () => {
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

    await runIngestCommandWithCuration({
      knowledgeRoot: ragRoot,
      input: await writeSurveyInput(
        inputRoot,
        'lightrag-query-modes.md',
        '# LightRAG Query Modes\n\nLightRAG RAG architecture combines hybrid retrieval, entity graph context, chunk embeddings, and rerank context before returning source passages.',
      ),
    })
    await runIngestCommandWithCuration({
      knowledgeRoot: financeRoot,
      input: await writeSurveyInput(
        inputRoot,
        'financial-architecture.md',
        '# Financial Foundation Models\n\nFinancial time-series models discuss AI architecture, forecasting workflows, market factors, and portfolio research methods.',
      ),
    })
    await runIngestCommandWithCuration({
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
      await runIngestCommandWithCuration({
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
        await runIngestCommandWithCuration({
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

    await runIngestCommandWithCuration({
      knowledgeRoot: agentRoot,
      input: await writeSurveyInput(
        inputRoot,
        'agent-engineering.md',
        '# Agent Engineering\n\nAn AI agent is a software system that uses tools, context, planning, and evaluation harnesses to complete tasks.',
      ),
    })
    await runIngestCommandWithCuration({
      knowledgeRoot: robotRoot,
      input: await writeSurveyInput(
        inputRoot,
        'robot-agent.md',
        '# Robot Agent Notes\n\nA robot agent appears in embodied perception benchmarks with cameras, LiDAR, and manipulation scenes.',
      ),
    })
    await runIngestCommandWithCuration({
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
    await runIngestCommandWithCuration({
      knowledgeRoot: ragRoot,
      input: await writeSurveyInput(
        inputRoot,
        'rag-table-fragment.md',
        '# RAG Table Fragment\n\n<td>GraphRAG</td><td>LightRAG</td><td>58.4%</td><td>GraphRAG</td><td>LightRAG</td><td>73.6%</td>',
      ),
    })
    await runIngestCommandWithCuration({
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
    await runIngestCommandWithCuration({ knowledgeRoot: financeRoot, input: financeSource })
    await runIngestCommandWithCuration({ knowledgeRoot: decoyRoot, input: decoySource })
    await runBuildIndexCommand({ knowledgeRoot: financeRoot })
    await runBuildIndexCommand({ knowledgeRoot: decoyRoot })

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: '基于AI的量化研究现在主要框架是怎样的，哪几种路线？',
      readingMode: 'document',
    })

    expect(result.results.map((entry) => entry.wikiId)).toEqual(expect.arrayContaining(['ai-finance', 'ai-agent-engineering']))
    expect(result.results.find((entry) => entry.wikiId === 'ai-agent-engineering')!.citationPack.length).toBeGreaterThan(0)
    expect(result.agentReadingPack.answerability).toBe('answered')
    expect(result.sourceReadingPack.passages.length).toBeGreaterThan(0)
    expect(result.sourceReadingPack.passages.every((passage) => passage.wikiId === 'ai-finance')).toBe(true)
    expect(result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')).toContain('AI-based quantitative research')
    expect(result.sourceReadingPack.passages.map((passage) => passage.text).join('\n')).not.toContain('General agent engineering')
  })
})
