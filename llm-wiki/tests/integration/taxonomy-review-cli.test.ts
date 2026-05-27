import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runCliFromArgv, runIngestCommand } from '../../src/cli.js'

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

  it('keeps rejected candidates out of the wiki layer and materializes only accepted topics', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-taxonomy-cleanup-'))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-taxonomy-cleanup-source-'))
    tempRoots.push(knowledgeRoot, sourceRoot)

    const sourcePath = path.join(sourceRoot, 'sensor-fusion.md')
    await writeFile(sourcePath, [
      '# Sensor Fusion Note',
      '',
      'entity: Sensor Fusion Stack',
      'concept: Durable Topic',
      'concept: Noisy Topic',
      '',
      'Sensor Fusion Stack connects Durable Topic and Noisy Topic in one note.',
      '',
    ].join('\n'), 'utf8')

    await runIngestCommand({ knowledgeRoot, input: sourcePath })

    const sourcePagePath = path.join(knowledgeRoot, 'wiki', 'sources', 'sensor-fusion-note.md')
    const noisyConceptPagePath = path.join(knowledgeRoot, 'wiki', 'concepts', 'noisy-topic.md')
    const durableConceptPagePath = path.join(knowledgeRoot, 'wiki', 'concepts', 'durable-topic.md')

    await expect(readFile(noisyConceptPagePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(durableConceptPagePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(sourcePagePath, 'utf8')).resolves.not.toContain('[[concepts/noisy-topic|Noisy Topic]]')
    await expect(readFile(sourcePagePath, 'utf8')).resolves.not.toContain('[[concepts/durable-topic|Durable Topic]]')

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
    await expect(readFile(sourcePagePath, 'utf8')).resolves.not.toContain('[[concepts/noisy-topic|Noisy Topic]]')

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

    const dedupManifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json'), 'utf8')) as {
      entries: Record<string, {
        lastOutputManifest: {
          pageFiles: string[]
          indexEntries: string[]
          pageSnapshots: Array<{ filePath: string; body: string }>
        } | null
      }>
    }
    const entry = Object.values(dedupManifest.entries)[0]?.lastOutputManifest
    expect(entry?.pageFiles).toContain('wiki/sources/sensor-fusion-note.md')
    expect(entry?.pageFiles).not.toContain('wiki/concepts/noisy-topic.md')
    expect(entry?.pageFiles).not.toContain('wiki/concepts/durable-topic.md')
    expect(entry?.indexEntries.some((value) => value.includes('concepts/noisy-topic'))).toBe(false)
    expect(entry?.pageSnapshots.some((snapshot) => snapshot.filePath === 'wiki/concepts/noisy-topic.md')).toBe(false)
    expect(entry?.pageSnapshots.some((snapshot) => snapshot.body.includes('[[concepts/noisy-topic|Noisy Topic]]'))).toBe(false)
  })
})
