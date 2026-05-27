import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIngestCommand, runLintCommand } from '../../src/cli'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('raw source integrity', () => {
  it('captures managed raw files with sha256 frontmatter and lint-detects drift', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-raw-integrity-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourcePath = path.join(inputRoot, 'compiler-notes.md')
    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic.\n',
      'utf8',
    )

    const ingest = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(ingest.retainedPath ?? ingest.archivePath).toBeTruthy()

    const rawPath = ingest.retainedPath ?? ingest.archivePath!
    const rawParts = path.relative(knowledgeRoot, rawPath).split(path.sep)
    expect(rawParts[0]).toBe('raw')
    expect(['staged', 'archive']).toContain(rawParts[1])
    expect(rawParts.length).toBeGreaterThanOrEqual(4)
    const rawContent = await readFile(rawPath, 'utf8')
    expect(rawContent).toContain('sha256:')
    expect(rawContent).toContain('immutable:')
    expect(rawContent).toContain('# Compiler Notes')

    const rawManifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'manifests', 'raw-sources.json'), 'utf8'))
    const manifestEntry = Object.values(rawManifest.entries)[0] as { relativePath?: string; sha256?: string }
    expect(manifestEntry).toMatchObject({
      relativePath: path.relative(knowledgeRoot, rawPath).replace(/\\/g, '/'),
      sha256: expect.any(String),
    })

    await expect(runLintCommand({ knowledgeRoot })).resolves.toMatchObject({ status: 'ok' })

    await appendFile(rawPath, '\nMUTATED AFTER CAPTURE\n', 'utf8')
    const lint = await runLintCommand({ knowledgeRoot })
    expect(lint.status).toBe('error')
    expect(lint.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'raw-source-drift', path: rawPath }),
    ]))
  })
})
