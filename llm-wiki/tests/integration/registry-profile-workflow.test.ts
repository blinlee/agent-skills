import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runCliFromArgv,
  runIntakeNextCommand,
  runIntakeParkCommand,
  runIntakeRejectCommand,
  runIntakeScanCommand,
  runProfileAcceptCommand,
  runProfileReviewCommand,
  runProfileSuggestCommand,
  runRegistryAddCommand,
  runRegistryInitCommand,
  runRouteCommand,
  runRouteInboxCommand,
} from '../../src/cli.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('registry profile proposal and intake parking workflow', () => {
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
