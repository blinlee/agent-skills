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

describe('registry bridge workflow', () => {
  it('indexes explicit cross-wiki bridge links and reports unresolved targets', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    const historyRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-history-'))
    tempRoots.push(registryRoot, aiRoot, historyRoot)

    await runRegistryAddCommand({ registryRoot, knowledgeRoot: aiRoot, id: 'ai', title: 'AI Wiki', scope: ['openclaw'] })
    await runRegistryAddCommand({ registryRoot, knowledgeRoot: historyRoot, id: 'history', title: 'History Wiki', scope: ['archive'] })
    const route = await runRouteCommand({ registryRoot, source: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md') })
    await runRouteAcceptCommand({ registryRoot, proposalId: route.proposal.id })

    await writeFile(path.join(historyRoot, 'wiki', 'index.md'), '# Wiki Index\n- [[sources/ai-history|AI History]]\n', 'utf8')
    await writeFile(
      path.join(historyRoot, 'wiki', 'sources', 'ai-history.md'),
      '# AI History\n\nSee llm-wiki://ai/sources/compiler-notes and llm-wiki://ai/concepts/missing-page.\n',
      'utf8',
    )

    const bridge = await runBridgeIndexCommand({ registryRoot })
    const persisted = await readFile(bridge.bridgeFile, 'utf8')

    expect(bridge.linkCount).toBe(2)
    expect(bridge.unresolvedCount).toBe(1)
    expect(bridge.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromWikiId: 'history', toWikiId: 'ai', toTarget: 'sources/compiler-notes', status: 'resolved' }),
      expect.objectContaining({ fromWikiId: 'history', toWikiId: 'ai', toTarget: 'concepts/missing-page', status: 'missing-page' }),
    ]))
    expect(persisted).toContain('llm-wiki://ai/sources/compiler-notes')
  })

  it('builds a reviewable classification package and bridge workflow for cross-domain sources', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryAddCommand({
      registryRoot,
      id: 'ai',
      title: 'AI Wiki',
      scope: ['neural networks', 'machine learning', 'pinn', 'physics-informed neural networks'],
    })
    await runRegistryAddCommand({
      registryRoot,
      id: 'physics',
      title: 'Physics Wiki',
      scope: ['physics', 'pde', 'differential equations', 'pinn'],
    })
    const source = path.join(registryRoot, 'raw', 'inbox', 'pinn.md')
    await writeFile(
      source,
      '# Physics-Informed Neural Networks\n\nPINN methods train neural networks with PDE residual losses for physics simulation and differential equations.',
      'utf8',
    )

    const routed = await runRouteInboxCommand({ registryRoot })
    const proposal = routed.results[0].proposal
    expect(proposal.decisionType).toBe('bridge_existing_wikis')
    expect(proposal.classificationPackage.primaryWiki?.wikiId).toBe(proposal.recommendedWikiId)
    expect(proposal.classificationPackage.secondaryWikis.map((wiki) => wiki.wikiId)).toContain(
      proposal.recommendedWikiId === 'ai' ? 'physics' : 'ai',
    )
    expect(proposal.classificationPackage.topics.length).toBeGreaterThan(1)
    expect(proposal.classificationPackage.topics.map((topic) => topic.slug)).toEqual(expect.arrayContaining([
      'physics-informed-neural-networks',
      'pinn',
    ]))
    expect(proposal.classificationPackage.topics.map((topic) => topic.slug)).not.toEqual(expect.arrayContaining([
      'with',
      'train',
      'using',
    ]))
    expect(proposal.classificationPackage.proposedOperations.every((operation) => operation.requiresHumanApproval)).toBe(true)
    expect(proposal.classificationPackage.reviewQuestions.join('\n')).toContain('主 wiki 是否分类正确')
    expect(proposal.classificationPackage.proposedOperations.map((operation) => operation.rationale).join('\n')).toContain('跨 wiki 连接是否合理')

    const accepted = await runRouteAcceptCommand({
      registryRoot,
      proposalId: proposal.id,
      reviewer: 'tester',
    })
    expect(accepted.bridgeProposalFiles.length).toBeGreaterThan(0)

    const bridgeList = await runBridgeListCommand({ registryRoot })
    expect(bridgeList.pendingCount).toBeGreaterThan(0)
    const bridgeAccepted = await runBridgeAcceptCommand({
      registryRoot,
      proposalId: bridgeList.proposals[0].id,
      reviewer: 'tester',
    })
    expect(bridgeAccepted.proposal.status).toBe('accepted')
    expect(bridgeAccepted.files.some((file) => file.endsWith('.md'))).toBe(true)
    await expect(readFile(bridgeAccepted.files.find((file) => file.endsWith('.md'))!, 'utf8')).resolves.toContain('## 跨 wiki 连接')
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
