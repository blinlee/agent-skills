import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIngestCommand, runIngestInboxCommand, runInitCommand } from '../../src/cli.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('cli ingest', () => {
  it('ingests a markdown file into wiki assets', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    const result = await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    expect(result.status).toBe('needs_review')
    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([expect.stringContaining('wiki/sources')]),
    )
  })

  it('ingests immediate raw/inbox sources as a low-friction vault intake path', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runInitCommand({ knowledgeRoot })
    await writeFile(
      path.join(knowledgeRoot, 'raw', 'inbox', 'alpha.md'),
      '# Inbox Alpha\n\nEntity: AlphaTeam\nConcept: reliability\n\nAlphaTeam keeps reliability visible.\n',
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'raw', 'inbox', 'beta.md'),
      '# Inbox Beta\n\nEntity: BetaTeam\nConcept: observability\n\nBetaTeam keeps observability visible.\n',
      'utf8',
    )

    const result = await runIngestInboxCommand({ knowledgeRoot })

    expect(result.results).toHaveLength(2)
    expect(result.results.map((item) => item.sourceKind)).toEqual(['md', 'md'])
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'inbox-alpha.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'inbox-beta.md'))).resolves.toBeUndefined()
  })
})
