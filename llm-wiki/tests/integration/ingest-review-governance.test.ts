import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIngestCommand } from '../../src/cli.js'

const tempRoots: string[] = []
const tempSources: string[] = []

afterEach(async () => {
  await Promise.all([
    ...tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })),
    ...tempSources.splice(0).map((target) => rm(target, { force: true })),
  ])
})

describe('ingest review governance', () => {
  it('keeps heuristic classifications out of durable pages and human approval queues', async () => {
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

    expect(ingestResult.reviewFiles.some((filePath) => filePath.includes(path.join('review', 'low-confidence')))).toBe(false)

    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'compiler-notes.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'rust-analyzer.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const reviewRecords = await Promise.all(
      ingestResult.reviewFiles
        .filter((filePath) => filePath.includes(path.join('review', 'queue')))
        .map(async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))),
    )
    expect(reviewRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'semantic-candidate',
        status: 'open',
        relatedSources: expect.arrayContaining([expect.stringContaining(path.basename(sourcePath))]),
        relatedPages: expect.arrayContaining(['sources/compiler-notes']),
        candidate: expect.objectContaining({
          kind: 'entity',
          slug: 'openclaw',
          title: 'OpenClaw',
          source: 'marker',
        }),
      }),
    ]))
    expect(JSON.stringify(reviewRecords)).not.toContain('Rust Analyzer')
  })

  it('routes filename/title/body mismatches into conflict review instead of silently accepting source metadata', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-review-governance-'))
    const sourcePath = path.join(os.tmpdir(), `RAG_for_AIGC_Survey_2024-${Date.now()}.md`)
    tempRoots.push(knowledgeRoot)
    tempSources.push(sourcePath)

    await writeFile(
      sourcePath,
      '# Pseduo-Random and de Bruijn Array Codes\n\nThis paper studies de Bruijn array codes and pseudo-random arrays for coding theory.\n',
      'utf8',
    )

    const ingestResult = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
    })

    expect(ingestResult.status).toBe('needs_review')
    expect(ingestResult.reviewFiles.some((filePath) => filePath.includes(path.join('review', 'conflicts')))).toBe(true)

    const conflictRecords = await Promise.all(
      ingestResult.reviewFiles
        .filter((filePath) => filePath.includes(path.join('review', 'conflicts')))
        .map(async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))),
    )

    expect(conflictRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'source-metadata-mismatch',
        status: 'open',
        issueSummary: expect.stringContaining('do not match parsed title'),
        mismatch: expect.objectContaining({
          sourceTokens: expect.arrayContaining(['rag', 'aigc', 'survey']),
          parsedTitle: 'Pseduo-Random and de Bruijn Array Codes',
        }),
      }),
    ]))
  })

  it('does not flag sources when filename tokens match parsed title evidence', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-review-governance-'))
    const sourcePath = path.join(os.tmpdir(), `rag-survey-${Date.now()}.md`)
    tempRoots.push(knowledgeRoot)
    tempSources.push(sourcePath)

    await writeFile(
      sourcePath,
      '# RAG Survey\n\nA survey of retrieval augmented generation systems and grounded citation workflows.\n',
      'utf8',
    )

    const ingestResult = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
    })

    const reviewRecords = await Promise.all(
      ingestResult.reviewFiles
        .filter((filePath) => filePath.includes(path.join('review', 'queue')))
        .map(async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))),
    )

    expect(reviewRecords).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'source-metadata-mismatch' }),
    ]))
  })

  it('removes stale review artifacts when recompiling a changed source', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-review-governance-'))
    const sourcePath = path.join(os.tmpdir(), `llm-wiki-source-${Date.now()}.md`)
    tempRoots.push(knowledgeRoot)
    tempSources.push(sourcePath)

    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic. Rust Analyzer observes the pipeline.\n',
      'utf8',
    )

    const firstIngest = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
    })

    const firstReviewArtifact = firstIngest.reviewFiles.find((filePath) => filePath.includes(path.join('review', 'queue')))
    expect(firstReviewArtifact).toBeTruthy()

    await writeFile(sourcePath, '# Scratch note\n\nplaceholder\n', 'utf8')

    const secondIngest = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
    })

    expect(secondIngest.status).toMatch(/completed|partial|needs_review/)

    const queueFiles = await readdir(path.join(knowledgeRoot, 'review', 'queue'))

    if (queueFiles.includes(path.basename(firstReviewArtifact!))) {
      await expect(readFile(path.join(knowledgeRoot, 'review', 'queue', path.basename(firstReviewArtifact!)), 'utf8')).resolves.not.toContain('Rust Analyzer')
    }
  })
})
