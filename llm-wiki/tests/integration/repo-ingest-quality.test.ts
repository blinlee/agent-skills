import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIngestCommand } from '../../src/cli.js'
import { runIngestCommandWithCuration } from '../helpers/curation.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('repo ingest quality', () => {
  it('suppresses repo wrapper, generic headings, and pronoun noise from becoming entity pages', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-repo-quality-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'repos', 'minimal-repo'),
    })

    const entityFiles = await readdir(path.join(knowledgeRoot, 'wiki', 'entities'))

    expect(entityFiles).toEqual([])
    expect(entityFiles).not.toEqual(expect.arrayContaining([
      'scope.md',
      'files.md',
      'captured.md',
      'readme.md',
      'api.md',
      'overview.md',
      'examples.md',
      'it.md',
      'this.md',
      'nested-readme.md',
    ]))
  })
})
