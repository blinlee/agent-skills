import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCliFromArgv, runIngestCommand, runLintCommand, runQueryCommand } from '../../src/cli.js'
import { contentDedupDatabasePath } from '../../src/intake/content-dedup-store.js'
import { runIngestCommandWithCuration, testConcept, testEntity, writeTestCurationPlan } from '../helpers/curation.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `no-embedding-config-${Date.now()}.json`))
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

function readContentDedupSqlite(knowledgeRoot: string): {
  records: Array<{ sourceIdentity: string; title: string; pageId: string; embeddingProvider: string | null; embeddingModel: string | null; embeddingVector: number[] | null }>
  logs: Array<{ action: string; reason: string; sourceIdentity: string; matchedSourceIdentity: string | null; similarity: number | null; userDecision: string | null }>
} {
  const db = new Database(contentDedupDatabasePath(knowledgeRoot))
  try {
    const records = db.prepare(`
      SELECT source_identity, title, page_id, embedding_provider, embedding_model, embedding_vector
      FROM dedup_index ORDER BY source_identity
    `).all() as Array<{ source_identity: string; title: string; page_id: string; embedding_provider: string | null; embedding_model: string | null; embedding_vector: Buffer | null }>
    const logs = db.prepare(`
      SELECT action, reason, source_identity, matched_source_identity, similarity, user_decision
      FROM dedup_log ORDER BY created_at, id
    `).all() as Array<{ action: string; reason: string; source_identity: string; matched_source_identity: string | null; similarity: number | null; user_decision: string | null }>

    return {
      records: records.map((record) => ({
        sourceIdentity: record.source_identity,
        title: record.title,
        pageId: record.page_id,
        embeddingProvider: record.embedding_provider,
        embeddingModel: record.embedding_model,
        embeddingVector: record.embedding_vector ? [...new Float32Array(record.embedding_vector.buffer, record.embedding_vector.byteOffset, record.embedding_vector.byteLength / Float32Array.BYTES_PER_ELEMENT)] : null,
      })),
      logs: logs.map((log) => ({
        action: log.action,
        reason: log.reason,
        sourceIdentity: log.source_identity,
        matchedSourceIdentity: log.matched_source_identity,
        similarity: log.similarity,
        userDecision: log.user_decision,
      })),
    }
  } finally {
    db.close()
  }
}

describe('cli ingest lifecycle regressions', () => {
  it('compiles first ingest, skips unchanged input, recompiles modified input, rejects unsupported input, and completes ordinary weak extraction without approval backlog', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourcePath = path.join(inputRoot, 'sample.md')
    await writeFile(
      sourcePath,
      await readFile(path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'), 'utf8'),
      'utf8',
    )

    const first = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Compilation', quote: 'Concept: compilation' })],
      }),
    })
    expect(first.status).toBe('completed')
    expect(first.dedupDecision).toEqual({ action: 'compile', reason: 'first-seen' })
    expect(first.archivePath).toContain(path.join('raw', 'archive'))
    await expect(access(first.archivePath!)).resolves.toBeUndefined()

    const second = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'GraphOps', quote: 'Entity: GraphOps' })],
        concepts: [testConcept({ title: 'Stability', quote: 'Concept: stability' })],
      }),
    })
    expect(second.status).toBe('completed')
    expect(second.dedupDecision).toEqual({ action: 'skip', reason: 'unchanged' })
    expect(second.writtenFiles).toEqual([])
    expect(second.archivePath).toBeNull()

    await writeFile(
      sourcePath,
      `${await readFile(sourcePath, 'utf8')}\nConcept: determinism\n`,
      'utf8',
    )

    const third = await runIngestCommandWithCuration({ knowledgeRoot, input: sourcePath })
    expect(third.status).toBe('completed')
    expect(third.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    expect(third.archivePath).toContain(path.join('raw', 'archive'))
    await expect(access(third.archivePath!)).resolves.toBeUndefined()

    const rejected = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'broken.bin'),
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectedPath).toContain(path.join('raw', 'rejected'))
    await expect(access(rejected.rejectedPath!)).resolves.toBeUndefined()

    const weak = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.txt'),
    })
    expect(weak.status).toBe('completed')
    expect(weak.reviewFiles).toEqual([])
    expect(weak.archivePath).toContain(path.join('raw', 'archive'))
    await expect(access(weak.archivePath!)).resolves.toBeUndefined()
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

    const first = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Compilation', quote: 'Concept: compilation' })],
      }),
    })
    expect(first.status).toBe('completed')
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'compiler-notes.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'))).resolves.toBeUndefined()

    await writeFile(
      sourcePath,
      '# Graph Digest\n\nEntity: GraphOps\nConcept: stability\n\nGraphOps keeps stability resilient.\n',
      'utf8',
    )

    const second = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'GraphOps', quote: 'Entity: GraphOps' })],
        concepts: [testConcept({ title: 'Stability', quote: 'Concept: stability' })],
      }),
    })
    expect(second.status).toBe('completed')
    expect(second.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })

    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'graph-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'graph-digest.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'graphops.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'stability.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'compiler-notes.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const lint = await runLintCommand({ knowledgeRoot })
    expect(lint.status).toBe('ok')

    const staleAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is OpenClaw?',
    })
    expect(staleAnswer.answer).not.toMatch(/Compiler Notes/)
    expect(staleAnswer.citations.map((citation) => citation.target)).not.toContain('sources/compiler-notes')

    const freshAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is GraphOps?',
    })
    expect(freshAnswer.citations.length).toBeGreaterThan(0)
    expect(freshAnswer.citations.map((citation) => citation.target)).toEqual(
      expect.arrayContaining(['sources/graph-digest']),
    )
  })

  it('persists retryable vs terminal URL failure states', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

        if (url.includes('type-error')) {
          throw new TypeError('fetch failed')
        }

        if (url.includes('abort-error')) {
          throw new DOMException('The operation was aborted.', 'AbortError')
        }

        if (url.includes('socket-reset')) {
          throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
        }

        if (url.includes('nested-timeout')) {
          throw new Error('fetch failed', { cause: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) })
        }

        const status = url.includes('too-many-requests')
          ? 429
          : url.includes('server-error')
            ? 500
            : 404

        return {
          ok: false,
          status,
          statusText: status === 404 ? 'Not Found' : 'Failure',
          text: async () => 'missing',
        } satisfies Partial<Response> as Response
      }),
    )

    const retryableInputs = [
      'https://type-error.example.test/article',
      'https://abort-error.example.test/article',
      'https://socket-reset.example.test/article',
      'https://nested-timeout.example.test/article',
      'https://too-many-requests.example.test/article',
      'https://server-error.example.test/article',
    ]

    for (const input of retryableInputs) {
      const retryable = await runIngestCommand({ knowledgeRoot, input })
      expect(retryable.status).toBe('failed_retryable')
      await expect(readPersistedJob(knowledgeRoot, retryable.jobId)).resolves.toMatchObject({
        status: 'failed_retryable',
        details: expect.objectContaining({
          step: 'failed',
        }),
      })
    }

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
  })})
