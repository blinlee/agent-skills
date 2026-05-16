import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIngestCommand } from '../../src/cli'

const tempRoots: string[] = []
const tempSources: string[] = []

afterEach(async () => {
  await Promise.all([
    ...tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })),
    ...tempSources.splice(0).map((target) => rm(target, { force: true })),
  ])
})

describe('ingest review governance', () => {
  it('gates low-confidence heuristic classifications behind review instead of durable wiki pages', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-review-governance-'))
    const sourcePath = path.join(os.tmpdir(), `llm-wiki-review-source-${Date.now()}.md`)
    tempRoots.push(knowledgeRoot)
    tempSources.push(sourcePath)

    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic. Rust Analyzer observes the pipeline.\n',
      'utf8',
    )

    const ingestResult = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
    })

    expect(ingestResult.status).toBe('needs_review')

    const lowConfidenceReview = ingestResult.reviewFiles.find((filePath) => filePath.includes(path.join('review', 'low-confidence')))
    expect(lowConfidenceReview).toBeTruthy()

    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'compiler-notes.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'rust-analyzer.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const reviewRecord = JSON.parse(await readFile(lowConfidenceReview!, 'utf8'))
    expect(reviewRecord).toEqual(expect.objectContaining({
      type: 'low-confidence',
      issueSummary: expect.stringMatching(/Rust Analyzer/),
      reason: expect.stringMatching(/gated/i),
      status: 'open',
      relatedSources: expect.arrayContaining([expect.stringContaining(path.basename(sourcePath))]),
      relatedPages: expect.arrayContaining(['sources/compiler-notes']),
      evidence: expect.arrayContaining([expect.stringMatching(/Rust Analyzer/)]),
      confidence: expect.any(Number),
      suggestedActions: expect.arrayContaining([expect.stringMatching(/review/i)]),
    }))
  })

  it('removes stale review artifacts when recompiling a changed source', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-review-governance-'))
    const sourcePath = path.join(os.tmpdir(), `llm-wiki-source-${Date.now()}.md`)
    tempRoots.push(knowledgeRoot)
    tempSources.push(sourcePath)

    await writeFile(sourcePath, await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'), 'utf8'), 'utf8')

    const firstIngest = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
    })

    const firstMergeCandidate = firstIngest.reviewFiles.find((filePath) => filePath.includes(path.join('review', 'merge-candidates')))
    expect(firstMergeCandidate).toBeTruthy()

    await writeFile(sourcePath, '# Scratch note\n\nplaceholder\n', 'utf8')

    const secondIngest = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
    })

    expect(secondIngest.status).toMatch(/completed|partial|needs_review/)

    const mergeCandidateFiles = await readdir(path.join(knowledgeRoot, 'review', 'merge-candidates'))
    const queueFiles = await readdir(path.join(knowledgeRoot, 'review', 'queue'))

    expect(mergeCandidateFiles).not.toContain(path.basename(firstMergeCandidate!))
    expect(queueFiles).not.toContain(path.basename(firstMergeCandidate!))
  })
})
