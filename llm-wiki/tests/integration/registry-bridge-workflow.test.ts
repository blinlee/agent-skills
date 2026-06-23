import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runCliFromArgv,
  runBridgeAcceptCommand,
  runBridgeCreateLandingCommand,
  runBridgeListCommand,
  runBridgeTargetsCommand,
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
import { runRouteAcceptCommandWithCuration } from '../helpers/curation.js'

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
    await runRouteAcceptCommandWithCuration({ registryRoot, proposalId: route.proposal.id })

    await writeFile(path.join(historyRoot, 'wiki', 'index.md'), '# Wiki Index\n- [[sources/ai-history|AI History]]\n', 'utf8')
    await writeFile(
      path.join(historyRoot, 'wiki', 'sources', 'ai-history.md'),
      '# AI History\n\nSee llm-wiki://ai/sources/compiler-notes, llm-wiki://ai/concepts/missing-page, and llm-wiki://ai/<section>/<slug>.\n',
      'utf8',
    )

    const bridge = await runBridgeIndexCommand({ registryRoot })
    const persisted = await readFile(bridge.bridgeFile, 'utf8')

    expect(bridge.linkCount).toBe(3)
    expect(bridge.unresolvedCount).toBe(3)
    expect(bridge.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromWikiId: 'history', toWikiId: 'ai', toTarget: 'sources/compiler-notes', status: 'orphan-rendered-link' }),
      expect.objectContaining({ fromWikiId: 'history', toWikiId: 'ai', toTarget: 'concepts/missing-page', status: 'missing-page' }),
      expect.objectContaining({ fromWikiId: 'history', toWikiId: 'ai', toTarget: '<section>/<slug>', status: 'placeholder-target' }),
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

    const accepted = await runRouteAcceptCommandWithCuration({
      registryRoot,
      proposalId: proposal.id,
      reviewer: 'tester',
    })
    expect(accepted.bridgeProposalFiles.length).toBeGreaterThan(0)

    const bridgeList = await runBridgeListCommand({ registryRoot })
    expect(bridgeList.pendingCount).toBeGreaterThan(0)

    const targets = await runBridgeTargetsCommand({ registryRoot, proposalId: bridgeList.proposals[0].id })
    expect(targets.candidates).toEqual(expect.any(Array))
    expect(targets.targetReadiness.indexStatus).toMatch(/missing-index|page-index-only|chunks-v2/)
    await expect(runBridgeAcceptCommand({
      registryRoot,
      proposalId: bridgeList.proposals[0].id,
      reviewer: 'tester',
    })).rejects.toThrow(/--target/)

    const bridgeAccepted = await runBridgeCreateLandingCommand({
      registryRoot,
      proposalId: bridgeList.proposals[0].id,
      reviewer: 'tester',
      slug: 'pinn-cross-context',
    })
    expect(bridgeAccepted.proposal.status).toBe('accepted')
    expect(bridgeAccepted.edge).toEqual(expect.objectContaining({
      status: 'resolved',
      toTarget: 'bridges/pinn-cross-context',
      link: expect.stringContaining('/bridges/pinn-cross-context'),
    }))
    expect(bridgeAccepted.files.some((file) => file.endsWith('.md'))).toBe(true)
    await expect(readFile(bridgeAccepted.files.find((file) => file.endsWith('.md'))!, 'utf8')).resolves.toContain('## 跨 wiki 连接')

    const bridgeIndex = await runBridgeIndexCommand({ registryRoot })
    expect(bridgeIndex.unresolvedCount).toBe(0)
    expect(bridgeIndex.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'resolved',
        toTarget: 'bridges/pinn-cross-context',
        source: 'rendered-link',
      }),
    ]))
  })

  it('requires concrete bridge targets and records retarget decisions', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-source-'))
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-target-'))
    const originalTargetRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-original-target-'))
    tempRoots.push(registryRoot, sourceRoot, targetRoot, originalTargetRoot)

    await runRegistryAddCommand({ registryRoot, knowledgeRoot: sourceRoot, id: 'source', title: 'Source Wiki', scope: ['source'] })
    await runRegistryAddCommand({ registryRoot, knowledgeRoot: targetRoot, id: 'target', title: 'Target Wiki', scope: ['target'] })
    await runRegistryAddCommand({ registryRoot, knowledgeRoot: originalTargetRoot, id: 'original', title: 'Original Target Wiki', scope: ['original'] })
    await writeFile(path.join(sourceRoot, 'wiki', 'index.md'), '# Wiki Index\n- [[sources/source-note|Source Note]]\n', 'utf8')
    await writeFile(path.join(sourceRoot, 'wiki', 'sources', 'source-note.md'), '# Source Note\n\nBridge source page.\n', 'utf8')
    await writeFile(path.join(targetRoot, 'wiki', 'index.md'), '# Wiki Index\n- [[sources/concrete-target|Concrete Target]]\n', 'utf8')
    await writeFile(path.join(targetRoot, 'wiki', 'sources', 'concrete-target.md'), '# Concrete Target\n\nBridge target page.\n', 'utf8')

    const proposalId = 'bridge-20260622-retarget-contract'
    await writeFile(path.join(registryRoot, 'registry', 'bridges', 'proposals', `${proposalId}.json`), JSON.stringify({
      id: proposalId,
      status: 'proposed',
      routeProposalId: 'route-test',
      fromWikiId: 'source',
      toWikiId: 'original',
      sourcePageTarget: 'sources/source-note',
      sourcePageFile: path.join(sourceRoot, 'wiki', 'sources', 'source-note.md'),
      suggestedLink: 'llm-wiki://original/<section>/<slug>',
      rationale: 'Target wiki should point at a concrete page.',
      reviewer: null,
      reviewedAt: null,
      reason: null,
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    }, null, 2), 'utf8')

    await expect(runBridgeAcceptCommand({ registryRoot, proposalId, reviewer: 'tester', target: 'target/<section>/<slug>' })).rejects.toThrow(/placeholder/)
    await expect(runBridgeAcceptCommand({ registryRoot, proposalId, reviewer: 'tester', target: 'target/sources/../secret' })).rejects.toThrow(/file path/)
    await expect(runBridgeAcceptCommand({ registryRoot, proposalId, reviewer: 'tester', target: 'target/sources/missing-page' })).rejects.toThrow(/does not exist/)
    await expect(runBridgeAcceptCommand({ registryRoot, proposalId, reviewer: 'tester', target: 'missing/sources/concrete-target' })).rejects.toThrow(/not registered/)

    const accepted = await runBridgeAcceptCommand({
      registryRoot,
      proposalId,
      reviewer: 'tester',
      target: 'wiki/target/sources/concrete-target.md',
      reason: 'retargeted to the concrete evidence page',
    })

    expect(accepted.edge).toEqual(expect.objectContaining({
      originalToWikiId: 'original',
      toWikiId: 'target',
      toTarget: 'sources/concrete-target',
      retargeted: true,
    }))
    await expect(readFile(accepted.decisionFile!, 'utf8')).resolves.toContain('"retargeted": true')
    await expect(readFile(path.join(sourceRoot, 'wiki', 'sources', 'source-note.md'), 'utf8')).resolves.toContain('llm-wiki://target/sources/concrete-target')
    await expect(runBridgeAcceptCommand({
      registryRoot,
      proposalId,
      reviewer: 'tester',
      target: 'target/sources/concrete-target',
    })).rejects.toThrow(/requires a proposed bridge/)

    await writeFile(path.join(sourceRoot, 'wiki', 'sources', 'source-note.md'), '# Source Note\n\nNo rendered bridge.\n', 'utf8')
    const unrenderedIndex = await runBridgeIndexCommand({ registryRoot })
    expect(unrenderedIndex.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'unrendered-edge', source: 'structured-edge', edgeId: `edge-${proposalId}` }),
    ]))

    await writeFile(path.join(targetRoot, 'wiki', 'sources', 'other-target.md'), '# Other Target\n', 'utf8')
    await writeFile(path.join(sourceRoot, 'wiki', 'sources', 'source-note.md'), '# Source Note\n\nSee llm-wiki://target/sources/other-target.\n', 'utf8')
    const staleIndex = await runBridgeIndexCommand({ registryRoot })
    expect(staleIndex.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'stale-edge', source: 'structured-edge', edgeId: `edge-${proposalId}` }),
      expect.objectContaining({ status: 'orphan-rendered-link', source: 'rendered-link', toTarget: 'sources/other-target' }),
    ]))
  })

  it('parses bridge CLI targets and surfaces target readiness through argv commands', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-source-'))
    const targetRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-target-'))
    tempRoots.push(registryRoot, sourceRoot, targetRoot)

    await runCliFromArgv(['registry-add', registryRoot, sourceRoot, '--id', 'source', '--title', 'Source', '--scope', 'source'])
    await runCliFromArgv(['registry-add', registryRoot, targetRoot, '--id', 'target', '--title', 'Target', '--scope', 'target'])
    await writeFile(path.join(sourceRoot, 'wiki', 'index.md'), '# Wiki Index\n- [[sources/source-note|Source Note]]\n', 'utf8')
    await writeFile(path.join(sourceRoot, 'wiki', 'sources', 'source-note.md'), '# Source Note\n\nBridge source page.\n', 'utf8')
    await writeFile(path.join(targetRoot, 'wiki', 'index.md'), '# Wiki Index\n- [[sources/target-note|Target Note]]\n', 'utf8')
    await writeFile(path.join(targetRoot, 'wiki', 'sources', 'target-note.md'), '# Target Note\n\nBridge target page.\n', 'utf8')

    const proposalId = 'bridge-20260622-cli-parser'
    await writeFile(path.join(registryRoot, 'registry', 'bridges', 'proposals', `${proposalId}.json`), JSON.stringify({
      id: proposalId,
      status: 'proposed',
      routeProposalId: 'route-test',
      fromWikiId: 'source',
      toWikiId: 'target',
      sourcePageTarget: 'sources/source-note',
      sourcePageFile: path.join(sourceRoot, 'wiki', 'sources', 'source-note.md'),
      suggestedLink: 'llm-wiki://target/<section>/<slug>',
      rationale: 'CLI parser should normalize target syntax.',
      reviewer: null,
      reviewedAt: null,
      reason: null,
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    }, null, 2), 'utf8')

    const targets = await runCliFromArgv(['bridge-targets', registryRoot, proposalId])
    expect(targets).toEqual(expect.objectContaining({
      targetReadiness: expect.objectContaining({ wikiId: 'target', indexStatus: 'page-index-only' }),
    }))
    await expect(runCliFromArgv(['bridge-accept', registryRoot, proposalId, '--target', 'target/<section>/<slug>', '--reviewer', 'tester'])).rejects.toThrow(/placeholder/)
    const accepted = await runCliFromArgv(['bridge-accept', registryRoot, proposalId, '--target', 'wiki/target/sources/target-note.md', '--reviewer', 'tester'])
    expect(accepted).toEqual(expect.objectContaining({
      edge: expect.objectContaining({
        toWikiId: 'target',
        toTarget: 'sources/target-note',
      }),
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
