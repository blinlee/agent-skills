import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { persistReviewItems } from '../../src/governance/review.js'
import { acceptTaxonomyProposal, applyTaxonomyEffects, listTaxonomyProposals, rejectTaxonomyProposal } from '../../src/governance/taxonomy.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((tempRoot) => rm(tempRoot, { recursive: true, force: true })))
})

describe('governance side effects', () => {
  it('persists low-confidence review items', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-governance-'))
    tempRoots.push(tempRoot)

    const output = await persistReviewItems(tempRoot, [
      { id: 'rv-1', type: 'low-confidence', issueSummary: 'topic unclear', status: 'open' },
    ])

    expect(output.files[0]).toContain('review/queue')

    const persisted = JSON.parse(await readFile(path.join(tempRoot, 'review', 'queue', 'rv-1.json'), 'utf8'))
    expect(persisted).toEqual(expect.objectContaining({
      id: 'rv-1',
      type: 'low-confidence',
      issueSummary: 'topic unclear',
      status: 'open',
    }))
  })

  it('removes stale grouped review projections when an item changes type', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-governance-'))
    tempRoots.push(tempRoot)

    await persistReviewItems(tempRoot, [
      { id: 'rv-1', type: 'low-confidence', issueSummary: 'topic unclear', status: 'open' },
    ])

    await persistReviewItems(tempRoot, [
      { id: 'rv-1', type: 'conflict', issueSummary: 'competing canonical topics', status: 'open' },
    ])

    const queueRecord = JSON.parse(await readFile(path.join(tempRoot, 'review', 'queue', 'rv-1.json'), 'utf8'))
    expect(queueRecord.type).toBe('conflict')

    await expect(access(path.join(tempRoot, 'review', 'low-confidence', 'rv-1.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const conflictRecord = JSON.parse(await readFile(path.join(tempRoot, 'review', 'conflicts', 'rv-1.json'), 'utf8'))
    expect(conflictRecord).toEqual(expect.objectContaining({
      id: 'rv-1',
      type: 'conflict',
      issueSummary: 'competing canonical topics',
    }))
  })

  it('creates topic proposals without forcing canonical structure', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-governance-'))
    tempRoots.push(tempRoot)

    const result = await applyTaxonomyEffects(tempRoot, {
      topicProposals: [{ name: 'compiler design', confidence: 0.62 }],
    })

    expect(result.proposalCount).toBe(1)

    const registry = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'topic-registry.json'), 'utf8'))
    const aliases = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'aliases.json'), 'utf8'))
    const proposal = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'proposals', 'compiler-design.json'), 'utf8'))

    expect(registry.topics).toEqual([])
    expect(aliases.aliases).toEqual({})
    expect(proposal).toEqual(expect.objectContaining({
      name: 'compiler design',
      slug: 'compiler-design',
      confidence: 0.62,
      status: 'proposed',
      canonicalized: false,
      reviewRequired: true,
      reviewer: null,
      reviewedAt: null,
    }))
  })

  it('adds parent candidates and bridge suggestions to topic proposals', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-governance-'))
    tempRoots.push(tempRoot)

    await applyTaxonomyEffects(tempRoot, {
      topicProposals: [
        { name: 'compiler design', confidence: 0.82, rationale: 'Compiler architecture topic.' },
        { name: 'runtime orchestration', confidence: 0.76, rationale: 'Runtime coordination topic.' },
      ],
    })

    const compilerProposal = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'proposals', 'compiler-design.json'), 'utf8'))
    const runtimeProposal = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'proposals', 'runtime-orchestration.json'), 'utf8'))

    expect(compilerProposal.parentCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'design', name: 'design' }),
    ]))
    expect(compilerProposal.bridgeSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'runtime-orchestration', name: 'runtime orchestration' }),
    ]))
    expect(runtimeProposal.bridgeSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'compiler-design', name: 'compiler design' }),
    ]))
  })

  it('uses a non-empty persisted slug for non-ascii topic proposals without auto-canonicalizing', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-governance-'))
    tempRoots.push(tempRoot)

    const result = await applyTaxonomyEffects(tempRoot, {
      topicProposals: [{ name: '编译器设计', confidence: 0.85, aliases: ['编译器', 'Compiler Design'] }],
    })

    const proposalFiles = await readdir(path.join(tempRoot, 'taxonomy', 'proposals'))
    expect(proposalFiles).toHaveLength(1)
    expect(proposalFiles[0]).toMatch(/.+\.json$/)
    expect(proposalFiles[0]).not.toBe('.json')
    expect(result.files.some((file) => file.endsWith(path.join('taxonomy', 'proposals', '.json')))).toBe(false)

    const proposal = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'proposals', proposalFiles[0]), 'utf8'))
    const registry = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'topic-registry.json'), 'utf8'))
    const aliases = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'aliases.json'), 'utf8'))

    expect(proposal.slug).toBeTruthy()
    expect(proposal).toEqual(expect.objectContaining({
      name: '编译器设计',
      confidence: 0.85,
      status: 'proposed',
      canonicalized: false,
      reviewRequired: true,
    }))
    expect(registry.topics).toEqual([])
    expect(aliases.aliases).toEqual({})
  })

  it('canonicalizes topics only after explicit human acceptance', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-governance-'))
    tempRoots.push(tempRoot)

    await applyTaxonomyEffects(tempRoot, {
      topicProposals: [{
        name: 'compiler design',
        confidence: 0.75,
        rationale: 'Initial canonical topic.',
        aliases: ['compiler architecture'],
      }],
    })

    let registry = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'topic-registry.json'), 'utf8'))
    let aliases = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'aliases.json'), 'utf8'))

    expect(registry.topics).toEqual([])
    expect(aliases.aliases).toEqual({})

    await acceptTaxonomyProposal(tempRoot, {
      slug: 'compiler-design',
      reviewer: 'human-reviewer',
    })

    const conceptPath = path.join(tempRoot, 'wiki', 'concepts', 'compiler-design.md')
    const curatedConceptBody = '# Compiler Design\n\nHuman-curated scope note that must survive repeated accepts.\n'
    await writeFile(conceptPath, curatedConceptBody, 'utf8')

    await acceptTaxonomyProposal(tempRoot, {
      slug: 'compiler-design',
      reviewer: 'second-reviewer',
    })

    await applyTaxonomyEffects(tempRoot, {
      topicProposals: [{
        name: 'compiler design',
        confidence: 0.91,
        rationale: 'Later model-only reclassification must not overwrite human acceptance.',
        aliases: ['compiler architecture', 'compilers'],
        sources: [{ slug: 'later-source', title: 'Later Source', artifactId: 'artifact-later' }],
      }],
    })

    registry = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'topic-registry.json'), 'utf8'))
    aliases = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'aliases.json'), 'utf8'))
    const proposal = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'proposals', 'compiler-design.json'), 'utf8'))
    const conceptBody = await readFile(conceptPath, 'utf8')
    const evidenceFiles = await readdir(path.join(tempRoot, 'taxonomy', 'evidence-proposals', 'compiler-design'))
    const evidenceProposal = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'evidence-proposals', 'compiler-design', evidenceFiles[0]), 'utf8'))

    expect(registry.topics).toHaveLength(1)
    expect(registry.topics[0]).toEqual(expect.objectContaining({
      slug: 'compiler-design',
      name: 'compiler design',
      confidence: 0.75,
      rationale: 'Initial canonical topic.',
    }))
    expect(aliases.aliases).toEqual(expect.objectContaining({
      'compiler-architecture': 'compiler-design',
    }))
    expect(Object.keys(aliases.aliases).filter((alias) => alias === 'compiler-architecture')).toHaveLength(1)
    expect(proposal).toEqual(expect.objectContaining({
      status: 'accepted',
      canonicalized: true,
      reviewRequired: false,
      reviewer: 'human-reviewer',
    }))
    expect(proposal.reviewedAt).toEqual(expect.any(String))
    expect(conceptBody).toBe(curatedConceptBody)
    expect(evidenceFiles).toHaveLength(1)
    expect(evidenceProposal).toEqual(expect.objectContaining({
      topicSlug: 'compiler-design',
      topicName: 'compiler design',
      source: expect.objectContaining({ slug: 'later-source', artifactId: 'artifact-later' }),
      status: 'pending',
      reviewRequired: true,
      reviewer: null,
    }))
  })
  it('lists taxonomy proposals as human-readable proposed operations and rejects without canonicalizing', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-governance-'))
    tempRoots.push(tempRoot)

    await applyTaxonomyEffects(tempRoot, {
      topicProposals: [{ name: 'compiler design', confidence: 0.72, aliases: ['compiler architecture'] }],
    })

    const listed = await listTaxonomyProposals(tempRoot)
    expect(listed.pendingCount).toBe(1)
    expect(listed.proposals[0]).toEqual(expect.objectContaining({
      slug: 'compiler-design',
      status: 'proposed',
      reviewRequired: true,
      proposedOperation: expect.objectContaining({
        action: 'canonicalize-topic',
      }),
    }))
    expect(listed.proposals[0].proposedOperation.effect).toContain('Accepting will add or update canonical topic')

    await rejectTaxonomyProposal(tempRoot, {
      slug: 'compiler-design',
      reviewer: 'human-reviewer',
      reason: 'Too broad.',
    })

    const relisted = await listTaxonomyProposals(tempRoot)
    const registry = JSON.parse(await readFile(path.join(tempRoot, 'taxonomy', 'topic-registry.json'), 'utf8'))

    expect(relisted.rejectedCount).toBe(1)
    expect(relisted.proposals[0]).toEqual(expect.objectContaining({
      status: 'rejected',
      reviewRequired: false,
      canonicalized: false,
      reviewer: 'human-reviewer',
    }))
    expect(registry.topics).toEqual([])
  })

})
