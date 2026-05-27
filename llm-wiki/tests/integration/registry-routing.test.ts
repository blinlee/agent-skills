import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
  runProfileAcceptCommand,
  runProfileReviewCommand,
  runProfileSuggestCommand,
  runQueryRegistryCommand,
  runRegistryAddCommand,
  runRegistryInitCommand,
  runRegistryListCommand,
  runBridgeIndexCommand,
  runRouteAcceptCommand,
  runRouteCommand,
  runRouteInboxCommand,
} from '../../src/cli.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('multi-wiki registry routing', () => {
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
    await expect(readFile(route.proposalFile, 'utf8')).resolves.toContain('humanReviewRequired')

    const accepted = await runRouteAcceptCommand({
      registryRoot,
      proposalId: route.proposal.id,
      reviewer: 'tester',
    })

    expect(accepted.decision.acceptedWikiId).toBe('ai')
    expect(accepted.decision.reviewer).toBe('tester')
    expect(['completed', 'needs_review']).toContain(accepted.decision.ingestResult.status)
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
    const accepted = await runRouteAcceptCommand({
      registryRoot,
      proposalId: route.proposal.id,
      wikiId: 'perception',
      reviewer: 'tester',
    })

    expect(['completed', 'needs_review', 'partial']).toContain(accepted.decision.ingestResult.status)
    await expect(readFile(path.join(perceptionRoot, 'wiki', 'sources', 'uni3d-moe.md'), 'utf8')).resolves.toContain('Uni3D-MoE')
  })

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

    const result = await runQueryRegistryCommand({
      registryRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(result.selectedWikis.map((wiki) => wiki.wikiId)).toContain('ai')
    expect(result.results[0].result?.citations.length).toBeGreaterThan(0)
    expect(result.answer).toContain('AI Wiki')
    expect(result.answer).toContain('ai:sources/compiler-notes')
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
    await expect(readFile(path.join(aiRoot, 'wiki', 'index.md'), 'utf8')).resolves.toBe('# Wiki Index\n')
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
      '# Compiler Routing Note\n\nOpenClaw compiler agent notes.',
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

    const accepted = await runRouteAcceptCommand({
      registryRoot,
      proposalId: routed.results[0].proposal.id,
      reviewer: 'tester',
    })
    expect(accepted.decision.acceptedWikiId).toBe('personal-ai')

    const afterAccept = await runIntakeStatusCommand({ registryRoot })
    expect(afterAccept.items[0]).toMatchObject({
      id: scan.discoveredItems[0].id,
      targetWikiId: 'personal-ai',
      routeProposalId: routed.results[0].proposal.id,
      reviewer: 'tester',
    })
    expect(['ingested', 'taxonomy_review']).toContain(afterAccept.items[0].status)

    const completed = await runIntakeCompleteCommand({
      registryRoot,
      itemId: scan.discoveredItems[0].id,
      reviewer: 'tester',
    })
    expect(completed.item.status).toBe('completed')

    const finalStatus = await runIntakeStatusCommand({ registryRoot })
    expect(finalStatus.pendingCount).toBe(0)
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
    expect(review.guidance.join('\n')).toContain('profile changes as proposals')
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
    expect(suggestion.proposal.proposedWiki?.granularity.splitWhen).toContain('expected recurring corpus')

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
    expect(proposal.risks.join(' ')).toMatch(/navigation context/i)
    expect(proposal.recommendedWikiId).toBe('ai')
  })

})
