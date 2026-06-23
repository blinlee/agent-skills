import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCliFromArgv } from '../../src/cli.js'
import { applyTaxonomyEffects } from '../../src/governance/taxonomy.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('taxonomy review CLI', () => {
  it('surfaces proposed classification before explicit human accept', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-taxonomy-review-'))
    tempRoots.push(knowledgeRoot)

    await applyTaxonomyEffects(knowledgeRoot, {
      topicProposals: [{
        name: 'Compiler Design',
        confidence: 0.92,
        rationale: 'Structural taxonomy proposal for compiler notes.',
        sources: [{ slug: 'compiler-notes', title: 'Compiler Notes', artifactId: 'sample-artifact' }],
      }],
    })

    const listed = await runCliFromArgv(['taxonomy-list', knowledgeRoot]) as {
      pendingCount: number
      proposals: Array<{ slug: string; proposedOperation: { action: string; effect: string } }>
    }

    expect(listed.pendingCount).toBeGreaterThan(0)
    expect(listed.proposals[0].proposedOperation.action).toBe('canonicalize-topic')
    expect(listed.proposals[0].proposedOperation.effect).toContain('Accepting will')

    const accepted = await runCliFromArgv([
      'taxonomy-accept',
      knowledgeRoot,
      listed.proposals[0].slug,
      '--reviewer',
      'human-reviewer',
    ])

    expect(accepted).toMatchObject({ status: 'accepted', slug: listed.proposals[0].slug })
  })

  it('requires a reviewer for taxonomy decisions', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-taxonomy-review-'))
    tempRoots.push(knowledgeRoot)

    await expect(runCliFromArgv(['taxonomy-accept', knowledgeRoot, 'compiler-design'])).rejects.toThrow('requires --reviewer')
  })

  it('keeps rejected candidates out of the wiki layer and materializes only accepted topics', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-taxonomy-cleanup-'))
    tempRoots.push(knowledgeRoot)

    await applyTaxonomyEffects(knowledgeRoot, {
      topicProposals: [
        {
          name: 'Durable Topic',
          confidence: 0.94,
          rationale: 'Reusable taxonomy topic.',
          sources: [{ slug: 'sensor-fusion-note', title: 'Sensor Fusion Note', artifactId: 'sensor-fusion' }],
        },
        {
          name: 'Noisy Topic',
          confidence: 0.91,
          rationale: 'Reviewable taxonomy noise candidate.',
          sources: [{ slug: 'sensor-fusion-note', title: 'Sensor Fusion Note', artifactId: 'sensor-fusion' }],
        },
      ],
    })

    const noisyConceptPagePath = path.join(knowledgeRoot, 'wiki', 'concepts', 'noisy-topic.md')
    const durableConceptPagePath = path.join(knowledgeRoot, 'wiki', 'concepts', 'durable-topic.md')

    await expect(readFile(noisyConceptPagePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(durableConceptPagePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await runCliFromArgv([
      'taxonomy-reject',
      knowledgeRoot,
      'noisy-topic',
      '--reviewer',
      'human-reviewer',
      '--reason',
      'paper-specific noise',
    ])

    await expect(readFile(noisyConceptPagePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    await runCliFromArgv([
      'taxonomy-accept',
      knowledgeRoot,
      'durable-topic',
      '--reviewer',
      'human-reviewer',
    ])

    await expect(readFile(durableConceptPagePath, 'utf8')).resolves.toContain('# Durable Topic')
    await expect(readFile(durableConceptPagePath, 'utf8')).resolves.toContain('[[sources/sensor-fusion-note|Sensor Fusion Note]]')
    await expect(readFile(durableConceptPagePath, 'utf8')).resolves.not.toContain('"noisy-topic"')

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent).not.toContain('[[concepts/noisy-topic|Noisy Topic]]')
    expect(indexContent).toContain('[[concepts/durable-topic|Durable Topic]]')
  })
})
