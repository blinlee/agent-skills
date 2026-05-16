import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCliFromArgv, runIngestCommand } from '../../src/cli'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('taxonomy review CLI', () => {
  it('surfaces proposed classification before explicit human accept', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-taxonomy-review-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
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
})
