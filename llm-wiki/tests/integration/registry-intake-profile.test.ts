import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runCliFromArgv,
  runBridgeAcceptCommand,
  runBridgeListCommand,
  runInitCommand,
  runIntakeNextCommand,
  runIntakeParkCommand,
  runIntakeRejectCommand,
  runIntakeScanCommand,
  runIntakeStatusCommand,
  runIngestCommand,
  runMaintainCommand,
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

describe('registry intake and profile workflow', () => {
  it('routes raw sources through a human-reviewed registry proposal before ingesting into a target wiki', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    const historyRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-history-'))
    tempRoots.push(registryRoot, aiRoot, historyRoot)

    await runRegistryInitCommand({ registryRoot })
    await runInitCommand({ knowledgeRoot: aiRoot })
    await runInitCommand({ knowledgeRoot: historyRoot })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: aiRoot,
      id: 'ai',
      title: 'AI / Agent Systems',
      scope: ['openclaw', 'agent', 'compiler', 'compilation', 'knowledge pipeline'],
    })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: historyRoot,
      id: 'history',
      title: 'Humanities History',
      scope: ['history', 'empire', 'archive', 'historiography'],
    })

    const list = await runRegistryListCommand({ registryRoot })
    expect(list.wikis.map((wiki) => wiki.id)).toEqual(['ai', 'history'])

    const source = path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md')
    const route = await runRouteCommand({ registryRoot, source })

    expect(route.proposal.humanReviewRequired).toBe(true)
    expect(route.proposal.status).toBe('proposed')
    expect(route.proposal.recommendedWikiId).toBe('ai')
    expect(route.proposal.candidates[0]).toMatchObject({ wikiId: 'ai' })
    expect(route.proposal.evidence.join('\n')).toContain('推荐归入已有 wiki')
    expect(route.proposal.humanQuestions.join('\n')).toContain('确认放入')
    expect(route.proposal.routingAssessment.rationale).toContain('可以建议放入')
    await expect(readFile(route.proposalFile, 'utf8')).resolves.toContain('humanReviewRequired')

    await stubEmbeddingProvider(path.join(registryRoot, 'embedding-config.json'))
    const accepted = await runRouteAcceptCommandWithCuration({
      registryRoot,
      proposalId: route.proposal.id,
      reviewer: 'tester',
    })

    expect(accepted.decision.acceptedWikiId).toBe('ai')
    expect(accepted.decision.reviewer).toBe('tester')
    expect(['completed', 'needs_review']).toContain(accepted.decision.ingestResult.status)
    expect(accepted.decision.ingestResult.index).toEqual(expect.objectContaining({
      status: 'rebuilt',
      chunkCount: expect.any(Number),
      pageCount: expect.any(Number),
    }))
    expect(accepted.decision.ingestResult.embedding).toEqual(expect.objectContaining({
      status: 'rebuilt',
      provider: 'local-http',
      model: 'test-embed',
      coverage: expect.objectContaining({
        currentChunkCount: accepted.decision.ingestResult.index!.chunkCount,
        finalVectorCount: accepted.decision.ingestResult.index!.chunkCount,
        remainingMissingVectorCount: 0,
      }),
    }))
    await expect(readFile(path.join(aiRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8')).resolves.toContain('Compiler Notes')
  })

  it('accepts a routed markdown source with frontmatter title without confusing body title-like text', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const perceptionRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-perception-'))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-source-'))
    tempRoots.push(registryRoot, perceptionRoot, sourceRoot)

    await runRegistryInitCommand({ registryRoot })
    await runInitCommand({ knowledgeRoot: perceptionRoot })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: perceptionRoot,
      id: 'perception',
      title: 'Embodied 3D Perception',
      scope: ['multimodal perception', '3d scene understanding', 'lidar-camera calibration', 'sensor fusion'],
    })

    const source = path.join(sourceRoot, 'uni3d-moe.md')
    await writeFile(source, [
      '---',
      'title: \"Uni3D-MoE\"',
      'source_label: \"tmp/uni3d-moe.pdf\"',
      '---',
      '',
      'Abstract',
      '',
      'Uni3D-MoE studies multimodal 3D scene understanding for embodied perception.',
      '',
      'Metadata block follows.',
      '',
      'title: this body line should not be parsed as frontmatter',
      '',
      '# Uni3D-MoE',
      '',
      'Further details on LiDAR-camera calibration and sensor fusion.',
      '',
    ].join('\n'), 'utf8')

    const route = await runRouteCommand({ registryRoot, source })
    const accepted = await runRouteAcceptCommandWithCuration({
      registryRoot,
      proposalId: route.proposal.id,
      wikiId: 'perception',
      reviewer: 'tester',
    })

    expect(['completed', 'needs_review', 'partial']).toContain(accepted.decision.ingestResult.status)
    await expect(readFile(path.join(perceptionRoot, 'wiki', 'sources', 'uni3d-moe.md'), 'utf8')).resolves.toContain('Uni3D-MoE')
  })

  it('keeps intake blocked when route-accept ingest needs review', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const theoryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-theory-'))
    tempRoots.push(registryRoot, theoryRoot)

    await runRegistryInitCommand({ registryRoot })
    await runInitCommand({ knowledgeRoot: theoryRoot })
    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: theoryRoot,
      id: 'theory',
      title: 'Theory Wiki',
      scope: ['de bruijn', 'coding theory', 'arrays'],
    })
    const inbox = path.join(registryRoot, 'raw', 'inbox')
    await mkdir(inbox, { recursive: true })
    await writeFile(
      path.join(inbox, 'RAG_for_AIGC_Survey_2024.md'),
      '# Pseduo-Random and de Bruijn Array Codes\n\nThis paper studies de Bruijn array codes and pseudo-random arrays for coding theory.\n',
      'utf8',
    )

    const routed = await runRouteInboxCommand({ registryRoot })
    expect(routed.results).toHaveLength(1)
    const accepted = await runRouteAcceptCommandWithCuration({
      registryRoot,
      proposalId: routed.results[0].proposal.id,
      wikiId: 'theory',
      reviewer: 'tester',
    })
    const acceptedAgain = await runRouteAcceptCommand({
      registryRoot,
      proposalId: routed.results[0].proposal.id,
      wikiId: 'theory',
      reviewer: 'tester',
    })
    const status = await runIntakeStatusCommand({ registryRoot })
    const proposalAfterBlockedAccept = JSON.parse(
      await readFile(path.join(registryRoot, 'registry', 'routing', 'proposals', `${routed.results[0].proposal.id}.json`), 'utf8'),
    ) as { status: string }

    expect(accepted.decision.status).toBe('blocked')
    expect(accepted.decision.ingestResult.status).toBe('needs_review')
    expect(accepted.bridgeProposalFiles).toEqual([])
    expect(proposalAfterBlockedAccept.status).toBe('proposed')
    expect(acceptedAgain.decision.status).toBe('blocked')
    expect(acceptedAgain.decision.ingestResult.status).toBe('needs_review')
    expect(acceptedAgain.decision.ingestResult.dedupDecision).toBeNull()
    expect(status.items).toEqual([
      expect.objectContaining({
        status: 'blocked',
        reviewRequired: true,
        completedAt: null,
        lastError: 'ingest status: needs_review',
      }),
    ])
    expect(status.pendingCount).toBe(1)
  })

  it('exposes registry commands through the JSON CLI argv surface', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    tempRoots.push(registryRoot, aiRoot)

    const addResult = await runCliFromArgv([
      'registry-add',
      registryRoot,
      aiRoot,
      '--id',
      'ai',
      '--title',
      'AI Wiki',
      '--scope',
      'openclaw,agent,compiler',
    ])

    expect(addResult).toMatchObject({ wiki: { id: 'ai', title: 'AI Wiki' } })

    const routeResult = await runCliFromArgv([
      'route',
      registryRoot,
      path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    ])

    expect(routeResult).toMatchObject({ proposal: { recommendedWikiId: 'ai', humanReviewRequired: true } })
  })

  it('routes every source from the registry global inbox without ingesting automatically', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    const aiRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-ai-'))
    tempRoots.push(registryRoot, aiRoot)

    await runRegistryAddCommand({
      registryRoot,
      knowledgeRoot: aiRoot,
      id: 'ai',
      title: 'AI Wiki',
      scope: ['openclaw', 'compiler', 'agent'],
    })
    const inboxSource = path.join(registryRoot, 'raw', 'inbox', 'compiler-note.md')
    await writeFile(inboxSource, '# Compiler Routing Note\n\nOpenClaw compiler agent notes.', 'utf8')

    const result = await runRouteInboxCommand({ registryRoot })

    expect(result.results).toHaveLength(1)
    expect(result.scan.newCount).toBe(1)
    expect(result.results[0].proposal.recommendedWikiId).toBe('ai')
    expect(result.results[0].proposal.humanReviewRequired).toBe(true)
    await expect(readFile(path.join(aiRoot, 'wiki', 'index.md'), 'utf8')).resolves.toBe('# Wiki 索引\n')
  })

  it('creates default atlas wiki roots under wikis/<id> and tracks raw intake state', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    const add = await runRegistryAddCommand({
      registryRoot,
      id: 'personal-ai',
      title: 'Personal AI',
      scope: ['openclaw', 'compiler', 'agent'],
    })

    expect(add.wiki.knowledgeRoot).toBe(path.join(registryRoot, 'wikis', 'personal-ai'))

    await writeFile(
      path.join(registryRoot, 'raw', 'inbox', 'compiler-note.md'),
      '# compiler note\n\nEntity: OpenClaw\nConcept: compiler routing\n\nOpenClaw compiler agent notes keep compiler routing visible.',
      'utf8',
    )

    const scan = await runIntakeScanCommand({ registryRoot })
    expect(scan.action).toBe('pending')
    expect(scan.newCount).toBe(1)
    expect(scan.discoveredItems[0]).toMatchObject({
      originalPath: path.join('raw', 'inbox', 'compiler-note.md'),
      currentPath: expect.stringContaining(path.join('raw', 'objects')),
      objectPath: expect.stringContaining(path.join('raw', 'objects')),
      status: 'discovered',
    })
    await expect(readdir(path.join(registryRoot, 'raw', 'inbox'))).resolves.toEqual([])
    await expect(access(path.join(registryRoot, scan.discoveredItems[0].objectPath!))).resolves.toBeUndefined()

    const next = await runIntakeNextCommand({ registryRoot })
    expect(next.action).toBe('route-source')
    expect(next.item?.currentPath).toContain(path.join('raw', 'objects'))

    const routed = await runRouteInboxCommand({ registryRoot })
    expect(routed.results).toHaveLength(1)
    expect(routed.results[0].proposal.intakeItemId).toBe(scan.discoveredItems[0].id)

    const proposed = await runIntakeStatusCommand({ registryRoot })
    expect(proposed.countsByStatus.route_proposed).toBe(1)
    const nextAfterRoute = await runIntakeNextCommand({ registryRoot })
    expect(nextAfterRoute.suggestedCommand).toContain('--quality <quality.json> --curation <curation.json>')

    const accepted = await runRouteAcceptCommandWithCuration({
      registryRoot,
      proposalId: routed.results[0].proposal.id,
      reviewer: 'tester',
    })
    expect(accepted.decision.acceptedWikiId).toBe('personal-ai')

    const afterAccept = await runIntakeStatusCommand({ registryRoot })
    expect(afterAccept.pendingCount).toBe(0)
    expect(afterAccept.items[0]).toMatchObject({
      id: scan.discoveredItems[0].id,
      status: 'completed',
      targetWikiId: 'personal-ai',
      routeProposalId: routed.results[0].proposal.id,
      reviewer: 'tester',
    })

    const finalStatus = await runIntakeStatusCommand({ registryRoot })
    expect(finalStatus.pendingCount).toBe(0)
  })

  it('moves quality and curation sidecars with registry inbox sources', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)
    await runRegistryInitCommand({ registryRoot })
    const inbox = path.join(registryRoot, 'raw', 'inbox')
    await writeFile(
      path.join(inbox, 'article.md'),
      '# Article\n\nThis is the source material.',
      'utf8',
    )
    await writeFile(
      path.join(inbox, 'article.md.quality.json'),
      JSON.stringify({ schema: 'llm-wiki.inbox-quality.v1', status: 'ready' }),
      'utf8',
    )
    await writeFile(
      path.join(inbox, 'article.md.curation.json'),
      JSON.stringify({ schema: 'llm-wiki.semantic-curation.v1', status: 'ready' }),
      'utf8',
    )

    const scan = await runIntakeScanCommand({ registryRoot })

    expect(scan.newCount).toBe(1)
    expect(scan.discoveredItems[0].fileName).toBe('article.md')
    expect(scan.discoveredItems[0].qualityPlanPath).toEqual(expect.stringContaining('article.md.quality.json'))
    expect(scan.discoveredItems[0].curationPlanPath).toEqual(expect.stringContaining('article.md.curation.json'))
    await expect(readdir(inbox)).resolves.toEqual([])
    await expect(access(path.join(registryRoot, scan.discoveredItems[0].qualityPlanPath!))).resolves.toBeUndefined()
    await expect(access(path.join(registryRoot, scan.discoveredItems[0].curationPlanPath!))).resolves.toBeUndefined()
  })

  it('maintains every registered wiki when called with an atlas registry root', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryAddCommand({
      registryRoot,
      id: 'ai',
      title: 'AI Wiki',
      scope: ['agent systems'],
    })
    await runRegistryAddCommand({
      registryRoot,
      id: 'finance',
      title: 'Finance Wiki',
      scope: ['quantitative finance'],
    })

    const maintained = await runMaintainCommand({ knowledgeRoot: registryRoot })

    expect(maintained).toMatchObject({
      kind: 'registry',
      registryRoot,
      status: 'ready',
    })
    if (maintained.kind !== 'registry') {
      throw new Error('expected registry maintain result')
    }
    expect(maintained.wikis.map((wiki) => wiki.wikiId)).toEqual(['ai', 'finance'])
    expect(maintained.wikis.every((wiki) => wiki.error === null)).toBe(true)
    expect(maintained.wikis.every((wiki) => wiki.index !== null)).toBe(true)
    expect(maintained.wikis.every((wiki) => wiki.okfDirectoryIndexes !== null)).toBe(true)
  })

  it('can reject a pending intake item with explicit human rationale', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryInitCommand({ registryRoot })
    await writeFile(path.join(registryRoot, 'raw', 'inbox', 'off-topic.md'), '# Off Topic\n\nNot useful.', 'utf8')
    const scan = await runIntakeScanCommand({ registryRoot })
    const rejected = await runIntakeRejectCommand({
      registryRoot,
      itemId: scan.discoveredItems[0].id,
      reviewer: 'tester',
      reason: 'wrong atlas',
    })

    expect(rejected.item).toMatchObject({
      status: 'rejected',
      reviewer: 'tester',
      reason: 'wrong atlas',
    })
    await expect(runIntakeNextCommand({ registryRoot })).resolves.toMatchObject({ action: 'silent' })
  })

  it('proposes a bounded new wiki profile instead of forcing unmatched sources into existing wikis', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryAddCommand({
      registryRoot,
      id: 'ai',
      title: 'AI Wiki',
      scope: ['agent', 'compiler', 'llm'],
      outOfScope: ['ancient history', 'archive'],
    })
    const source = path.join(registryRoot, 'raw', 'inbox', 'roman-frontier.md')
    await writeFile(source, '# Roman Frontier Archaeology\n\nExcavation notes about pottery, forts, epigraphy, and provincial administration on the Danube frontier.', 'utf8')

    const scan = await runIntakeScanCommand({ registryRoot })
    const routed = await runRouteInboxCommand({ registryRoot })
    const proposal = routed.results[0].proposal

    expect(proposal.decisionType).toBe('create_new_wiki')
    expect(proposal.recommendedWikiId).toBeNull()
    expect(proposal.newWikiProposalId).toMatch(/^profile-/)
    expect(proposal.classificationPolicy.requiredSatisfiedCount).toBeGreaterThanOrEqual(3)

    const next = await runIntakeNextCommand({ registryRoot })
    expect(next).toMatchObject({
      action: 'profile-review',
      item: { id: scan.discoveredItems[0].id },
    })

    const acceptedProfile = await runProfileAcceptCommand({
      registryRoot,
      proposalId: proposal.newWikiProposalId!,
      reviewer: 'tester',
      reason: 'recurring domain',
    })
    expect(acceptedProfile.proposal.status).toBe('accepted')
    expect(acceptedProfile.profileFile).toContain(path.join('registry', 'profiles'))

    const review = await runProfileReviewCommand({ registryRoot })
    expect(review.guidance.join('\n')).toContain('profile 变更必须先作为提案审核')
  })

  it('does not route sources from generic AI vocabulary without profile-level evidence', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryAddCommand({
      registryRoot,
      id: 'ai-agent-engineering',
      title: 'AI Agent Engineering',
      scopeCore: ['LLM agents', 'multi-agent systems', 'agent engineering', 'agent evaluation'],
      scopeAdjacent: ['LLM application development'],
    })
    await runRegistryAddCommand({
      registryRoot,
      id: 'ai-finance',
      title: 'AI Finance',
      scopeCore: ['financial time-series forecasting', 'financial foundation models', 'quantitative finance modeling'],
      scopeAdjacent: ['agentic factor research'],
    })
    const source = path.join(registryRoot, 'raw', 'inbox', 'vision-language-models.md')
    await writeFile(
      source,
      '# Transferable Vision-Language Models\n\nA foundation model learns visual representations from natural language supervision. The paper discusses model evaluation, image-text data, benchmark transfer, and representation learning. It is not about markets, trading, coding assistants, or teams of autonomous agents as the primary retrieval intent.',
      'utf8',
    )

    const routed = await runRouteInboxCommand({ registryRoot })
    const proposal = routed.results[0].proposal

    expect(proposal.decisionType).toBe('create_new_wiki')
    expect(proposal.recommendedWikiId).toBeNull()
    expect(proposal.bridgeSuggestions).toEqual([])
    expect(proposal.candidates.every((candidate) => candidate.matchQuality !== 'strong')).toBe(true)
    expect(proposal.routingAssessment).toMatchObject({
      ownershipDecision: 'new_profile',
      relationshipHint: 'generic_overlap',
      novelty: 'high',
    })
  })

  it('does not turn fragmented tokens from multiword scope phrases into a strong route', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryAddCommand({
      registryRoot,
      id: 'embodied-3d-perception',
      title: 'Embodied 3D Perception',
      scopeCore: ['3D scene understanding', 'multimodal perception', 'robot perception'],
    })
    const source = path.join(registryRoot, 'raw', 'inbox', 'vision-language-models.md')
    await writeFile(
      source,
      '# Vision-Language Models\n\nThe paper reports multimodal language model training for image recognition, scene understanding, and visual transfer. It mentions perception benchmarks but is not about depth reconstruction, robotics sensing, or embodied spatial navigation as a knowledge-boundary fit.',
      'utf8',
    )

    const routed = await runRouteInboxCommand({ registryRoot })
    const proposal = routed.results[0].proposal

    expect(proposal.decisionType).toBe('create_new_wiki')
    expect(proposal.recommendedWikiId).toBeNull()
    expect(proposal.candidates[0]).toMatchObject({
      wikiId: 'embodied-3d-perception',
      matchQuality: 'moderate',
    })
    expect(proposal.routingAssessment.relationshipHint).not.toBe('same_scheme')
  })

  it('marks focused adjacent evidence as a possible child profile instead of direct ownership', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryAddCommand({
      registryRoot,
      id: 'embodied-3d-perception',
      title: 'Embodied 3D Perception',
      scopeCore: ['embodied perception', 'robot perception', 'multimodal perception', 'sensor fusion'],
    })
    const source = path.join(registryRoot, 'raw', 'inbox', 'robotic-control.md')
    await writeFile(
      source,
      '# Vision-Language-Action Models for Robotic Control\n\nThis paper studies robotic control policies that adapt vision-language models to output robot actions. The abstract emphasizes robot manipulation, multimodal signals, embodied evaluation, and sensor observations, but its primary retrieval intent is robot foundation models rather than perception-only methods.',
      'utf8',
    )

    const routed = await runRouteInboxCommand({ registryRoot })
    const proposal = routed.results[0].proposal

    expect(proposal.decisionType).toBe('create_new_wiki')
    expect(proposal.recommendedWikiId).toBeNull()
    expect(proposal.candidates[0]).toMatchObject({
      wikiId: 'embodied-3d-perception',
      matchQuality: 'moderate',
      relationshipHint: 'possible_child_profile',
    })
    expect(proposal.candidates[0].focusedMatches).toEqual(expect.arrayContaining(['robot']))
    expect(proposal.routingAssessment).toMatchObject({
      ownershipDecision: 'new_profile',
      relationshipHint: 'possible_child_profile',
      nearestWikiId: 'embodied-3d-perception',
      novelty: 'medium',
    })
  })

  it('can draft and park profile decisions without polluting the atlas', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryInitCommand({ registryRoot })
    const source = path.join(registryRoot, 'raw', 'inbox', 'rare-topic.md')
    await writeFile(source, '# Rare One-off Topic\n\nA single clipping with uncertain future use and no stable domain boundary.', 'utf8')
    const scan = await runIntakeScanCommand({ registryRoot })

    const suggestion = await runProfileSuggestCommand({
      registryRoot,
      intakeItemId: scan.discoveredItems[0].id,
      id: 'rare-topic',
      title: 'Rare Topic',
    })
    expect(suggestion.proposal.rationale).toContain('不应静默扩大某个 wiki 的范围')
    expect(suggestion.proposal.reviewQuestions.join('\n')).toContain('后续是否会继续收集材料')
    expect(suggestion.proposal.proposedWiki?.granularity.splitWhen).toContain('预期会持续积累同类材料')

    const parked = await runIntakeParkCommand({
      registryRoot,
      itemId: scan.discoveredItems[0].id,
      reviewer: 'tester',
      reason: 'single source is not enough to create a wiki',
    })
    expect(parked.item.status).toBe('parked')
    await expect(runIntakeNextCommand({ registryRoot })).resolves.toMatchObject({ action: 'silent' })
  })

  it('routes the first atlas source into a profile proposal when no wiki exists yet', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryInitCommand({ registryRoot })
    await writeFile(
      path.join(registryRoot, 'raw', 'inbox', 'first-domain.md'),
      '# Materials Science Notes\n\nCrystallography, alloy phase diagrams, microscopy, and grain boundary observations.',
      'utf8',
    )

    const routed = await runRouteInboxCommand({ registryRoot })
    expect(routed.results[0].proposal).toMatchObject({
      decisionType: 'create_new_wiki',
      recommendedWikiId: null,
      humanReviewRequired: true,
    })
    expect(routed.results[0].proposal.newWikiProposalId).toMatch(/^profile-/)
  })

  it('parks index/source-map files instead of routing them as ordinary canonical knowledge', async () => {
    const registryRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-registry-'))
    tempRoots.push(registryRoot)

    await runRegistryAddCommand({
      registryRoot,
      id: 'ai',
      title: 'AI Wiki',
      scope: ['compiler notes', 'slash commands', 'harness design'],
    })
    const source = path.join(registryRoot, 'raw', 'inbox', 'INDEX.md')
    await writeFile(
      source,
      '# INDEX\n\n- [Compiler Notes](compiler-notes.md)\n- [Slash Commands](slash-commands.md)\n- [Harness Design](harness-design.md)\n',
      'utf8',
    )

    const routed = await runRouteInboxCommand({ registryRoot })
    const proposal = routed.results[0].proposal

    expect(proposal.decisionType).toBe('park_for_later')
    expect(proposal.parkReason).toMatch(/source-map/i)
    expect(proposal.risks.join(' ')).toContain('导航')
    expect(proposal.recommendedWikiId).toBe('ai')
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
