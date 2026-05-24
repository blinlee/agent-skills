import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIngestCommand, runLintCommand, runQueryCommand } from '../../src/cli'

const tempRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

async function readPersistedJob(knowledgeRoot: string, jobId: string) {
  const raw = await readFile(path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'), 'utf8')
  const state = JSON.parse(raw) as {
    jobs: Record<string, { status: string; details?: Record<string, unknown> }>
  }

  return state.jobs[jobId]
}

async function removeStoredPageSnapshots(knowledgeRoot: string, sourcePath: string) {
  const manifestPath = path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json')
  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as {
    entries: Record<string, { lastOutputManifest?: { pageSnapshots?: unknown[] } | null }>
  }

  const entry = manifest.entries[path.resolve(sourcePath)]
  if (!entry?.lastOutputManifest) {
    throw new Error(`Missing dedup manifest entry for ${sourcePath}`)
  }

  delete entry.lastOutputManifest.pageSnapshots
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

describe('cli dedup and lifecycle', () => {
  it('compiles first ingest, skips unchanged input, recompiles modified input, rejects unsupported input, and keeps weak extraction reviewable', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourcePath = path.join(inputRoot, 'sample.md')
    await writeFile(
      sourcePath,
      await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'), 'utf8'),
      'utf8',
    )

    const first = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(first.status).toBe('needs_review')
    expect(first.dedupDecision).toEqual({ action: 'compile', reason: 'first-seen' })
    expect(first.retainedPath).toContain(path.join('raw', 'staged'))
    await expect(access(first.retainedPath!)).resolves.toBeUndefined()

    const second = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(second.status).toBe('completed')
    expect(second.dedupDecision).toEqual({ action: 'skip', reason: 'unchanged' })
    expect(second.writtenFiles).toEqual([])
    expect(second.archivePath).toBeNull()

    await writeFile(
      sourcePath,
      `${await readFile(sourcePath, 'utf8')}\nConcept: determinism\n`,
      'utf8',
    )

    const third = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(third.status).toBe('needs_review')
    expect(third.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    expect(third.retainedPath).toContain(path.join('raw', 'staged'))
    await expect(access(third.retainedPath!)).resolves.toBeUndefined()

    const rejected = await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'broken.bin'),
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectedPath).toContain(path.join('raw', 'rejected'))
    await expect(access(rejected.rejectedPath!)).resolves.toBeUndefined()

    const weak = await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.txt'),
    })
    expect(['needs_review', 'partial']).toContain(weak.status)
    expect(weak.reviewFiles.length).toBeGreaterThan(0)
    expect(weak.retainedPath).toContain(path.join('raw', 'staged'))
    await expect(access(weak.retainedPath!)).resolves.toBeUndefined()
  })

  it('removes stale derived pages and stale query answers after a changed-source recompile', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourcePath = path.join(inputRoot, 'compiler-notes.md')
    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic.\n',
      'utf8',
    )

    const first = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(first.status).toBe('needs_review')
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    await writeFile(
      sourcePath,
      '# Graph Digest\n\nEntity: GraphOps\nConcept: stability\n\nGraphOps keeps stability resilient.\n',
      'utf8',
    )

    const second = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(second.status).toBe('needs_review')
    expect(second.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })

    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'graph-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const lint = await runLintCommand({ knowledgeRoot })
    expect(lint.status).toBe('ok')

    const staleAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is OpenClaw?',
    })
    expect(staleAnswer.answer).toMatch(/could not find enough matching evidence/i)
    expect(staleAnswer.citations).toEqual([])

    const freshAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is GraphOps?',
    })
    expect(freshAnswer.citations.length).toBeGreaterThan(0)
    expect(freshAnswer.citations.map((citation) => citation.target)).toEqual(
      expect.arrayContaining(['sources/graph-digest']),
    )
  })

  it('cleans stale derived pages for legacy manifests that do not have pageSnapshots', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourcePath = path.join(inputRoot, 'compiler-notes.md')
    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic.\n',
      'utf8',
    )

    const first = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(first.status).toBe('needs_review')
    await removeStoredPageSnapshots(knowledgeRoot, sourcePath)

    await writeFile(
      sourcePath,
      '# Graph Digest\n\nEntity: GraphOps\nConcept: stability\n\nGraphOps keeps stability resilient.\n',
      'utf8',
    )

    const second = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    expect(second.status).toBe('needs_review')
    expect(second.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })

    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'graph-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const lint = await runLintCommand({ knowledgeRoot })
    expect(lint.status).toBe('ok')

    const staleAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is OpenClaw?',
    })
    expect(staleAnswer.answer).toMatch(/could not find enough matching evidence/i)
    expect(staleAnswer.citations).toEqual([])
  })

  it('persists retryable vs terminal URL failure states', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

        if (url.includes('retryable')) {
          throw new TypeError('fetch failed')
        }

        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: async () => 'missing',
        } satisfies Partial<Response> as Response
      }),
    )

    const retryable = await runIngestCommand({
      knowledgeRoot,
      input: 'https://retryable.example.test/article',
    })
    expect(retryable.status).toBe('failed_retryable')
    await expect(readPersistedJob(knowledgeRoot, retryable.jobId)).resolves.toMatchObject({
      status: 'failed_retryable',
      details: expect.objectContaining({
        step: 'failed',
      }),
    })

    const terminal = await runIngestCommand({
      knowledgeRoot,
      input: 'https://terminal.example.test/missing',
    })
    expect(terminal.status).toBe('failed_terminal')
    await expect(readPersistedJob(knowledgeRoot, terminal.jobId)).resolves.toMatchObject({
      status: 'failed_terminal',
      details: expect.objectContaining({
        step: 'failed',
      }),
    })
  })
})
