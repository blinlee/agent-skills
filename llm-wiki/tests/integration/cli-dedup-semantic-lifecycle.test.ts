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

describe('cli semantic dedup decisions', () => {
  it('skips high-similarity semantic duplicates when a document embedding provider is configured', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-semantic-dedup-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string }
      const text = body.input ?? ''
      const vector = text.includes('variant two') ? [0.9999, 0.0001] : [1, 0]
      return new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const firstPath = path.join(inputRoot, 'semantic-a.md')
    const secondPath = path.join(inputRoot, 'semantic-b.md')
    await writeFile(firstPath, '# Semantic Dedup Alpha\n\nEntity: SemanticDedup\nConcept: content hygiene\n\nVariant one says semantic dedup removes near duplicate research notes.\n', 'utf8')
    await writeFile(secondPath, '# Semantic Dedup Beta\n\nEntity: SemanticDedup\nConcept: content hygiene\n\nvariant two says semantic dedup removes nearly duplicate research notes with small wording changes.\n', 'utf8')

    const first = await runIngestCommandWithCuration({ knowledgeRoot, input: firstPath })
    const second = await runIngestCommandWithCuration({ knowledgeRoot, input: secondPath })
    const contentIndex = readContentDedupSqlite(knowledgeRoot)

    expect(['completed', 'needs_review', 'partial']).toContain(first.status)
    expect(second.status).toBe('completed')
    expect(second.dedupDecision).toEqual({ action: 'skip', reason: 'content-semantic-high' })
    expect(second.writtenFiles).toEqual([])
    expect(contentIndex.records).toHaveLength(1)
    expect(contentIndex.records[0]).toEqual(expect.objectContaining({
      sourceIdentity: path.resolve(firstPath),
      embeddingProvider: 'local-http',
      embeddingModel: 'bge-m3',
      embeddingVector: [1, 0],
    }))
    expect(contentIndex.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'skip',
        reason: 'semantic_0.98',
        sourceIdentity: path.resolve(secondPath),
        matchedSourceIdentity: path.resolve(firstPath),
        similarity: expect.any(Number),
      }),
    ]))
  })

  it('pauses ambiguous semantic duplicates until a user decision is recorded', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-confirm-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string }
      const text = body.input ?? ''
      const vector = text.includes('ambiguous two') ? [0.9, 0.4358898943540673] : [1, 0]
      return new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const firstPath = path.join(inputRoot, 'confirm-a.md')
    const secondPath = path.join(inputRoot, 'confirm-b.md')
    await writeFile(firstPath, '# Dedup Confirm Alpha\n\nEntity: DedupConfirm\nConcept: confirmation flow\n\nBaseline document about dedup confirmation.\n', 'utf8')
    await writeFile(secondPath, '# Dedup Confirm Beta\n\nEntity: DedupConfirm\nConcept: confirmation flow\n\nambiguous two document about duplicate confirmation with wording changes.\n', 'utf8')

    const first = await runIngestCommandWithCuration({ knowledgeRoot, input: firstPath })
    const second = await runIngestCommandWithCuration({ knowledgeRoot, input: secondPath })
    const pending = await runCliFromArgv(['dedup', knowledgeRoot, 'pending']) as {
      pending: Array<{ id: string; sourceIdentity: string; matchedSourceIdentity: string; similarity: number; status: string }>
    }
    const check = await runCliFromArgv(['dedup', knowledgeRoot, 'check', secondPath]) as {
      candidates: Array<{ reason: string; record: { sourceIdentity: string } }>
    }
    const stats = await runCliFromArgv(['dedup', knowledgeRoot, 'stats']) as {
      stats: { recordCount: number; pendingDecisionCount: number }
    }

    expect(['completed', 'needs_review', 'partial']).toContain(first.status)
    expect(second.status).toBe('needs_review')
    expect(second.dedupDecision).toEqual({ action: 'pending', reason: 'content-dedup-confirmation' })
    expect(second.writtenFiles).toEqual([])
    expect(pending.pending).toHaveLength(1)
    expect(pending.pending[0]).toEqual(expect.objectContaining({
      status: 'pending',
      sourceIdentity: path.resolve(secondPath),
      matchedSourceIdentity: path.resolve(firstPath),
      similarity: expect.any(Number),
    }))
    expect(check.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'semantic_match',
        record: expect.objectContaining({ sourceIdentity: path.resolve(firstPath) }),
      }),
    ]))
    expect(stats.stats).toEqual(expect.objectContaining({
      recordCount: 1,
      pendingDecisionCount: 1,
    }))

    await runCliFromArgv([
      'dedup',
      knowledgeRoot,
      'decide',
      pending.pending[0]!.id,
      '--decision',
      'skip',
      '--reviewer',
      'tester',
      '--note',
      'duplicate',
    ])

    const third = await runIngestCommandWithCuration({ knowledgeRoot, input: secondPath })
    const afterDecision = await runCliFromArgv(['dedup', knowledgeRoot, 'pending']) as { pending: unknown[] }
    const contentIndex = readContentDedupSqlite(knowledgeRoot)

    expect(third.status).toBe('completed')
    expect(third.dedupDecision).toEqual({ action: 'skip', reason: 'content-dedup-user-skip' })
    expect(third.writtenFiles).toEqual([])
    expect(afterDecision.pending).toEqual([])
    expect(contentIndex.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'pending', reason: 'semantic_0.88', sourceIdentity: path.resolve(secondPath) }),
      expect.objectContaining({ action: 'decision', reason: 'user_override', userDecision: 'skip', sourceIdentity: path.resolve(secondPath) }),
    ]))
  })

  it('scans recorded semantic duplicate candidates after a keep decision allows ingest', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-scan-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const configPath = path.join(knowledgeRoot, 'config.json')
    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/embed',
        model: 'bge-m3',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string }
      const text = body.input ?? ''
      const vector = text.includes('scan two') ? [0.9, 0.4358898943540673] : [1, 0]
      return new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const firstPath = path.join(inputRoot, 'scan-a.md')
    const secondPath = path.join(inputRoot, 'scan-b.md')
    await writeFile(firstPath, '# Dedup Scan Alpha\n\nEntity: DedupScan\nConcept: duplicate audit\n\nBaseline document about duplicate scanning.\n', 'utf8')
    await writeFile(secondPath, '# Dedup Scan Beta\n\nEntity: DedupScan\nConcept: duplicate audit\n\nscan two document about duplicate scanning with wording changes.\n', 'utf8')

    await runIngestCommandWithCuration({ knowledgeRoot, input: firstPath })
    await runIngestCommandWithCuration({ knowledgeRoot, input: secondPath })
    const pending = await runCliFromArgv(['dedup', knowledgeRoot, 'pending']) as { pending: Array<{ id: string }> }
    await runCliFromArgv([
      'dedup',
      knowledgeRoot,
      'decide',
      pending.pending[0]!.id,
      '--decision',
      'ingest',
      '--reviewer',
      'tester',
    ])
    const ingested = await runIngestCommandWithCuration({ knowledgeRoot, input: secondPath })
    const scan = await runCliFromArgv(['dedup', knowledgeRoot, 'scan']) as {
      candidates: Array<{ reason: string; left: { sourceIdentity: string }; right: { sourceIdentity: string }; similarity: number }>
    }
    const stats = await runCliFromArgv(['dedup', knowledgeRoot, 'stats']) as {
      stats: { recordCount: number; resolvedDecisionCount: number }
    }

    expect(['completed', 'needs_review', 'partial']).toContain(ingested.status)
    expect(scan.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason: 'semantic_match',
        left: expect.objectContaining({ sourceIdentity: path.resolve(firstPath) }),
        right: expect.objectContaining({ sourceIdentity: path.resolve(secondPath) }),
        similarity: expect.any(Number),
      }),
    ]))
    expect(stats.stats).toEqual(expect.objectContaining({
      recordCount: 2,
      resolvedDecisionCount: 1,
    }))
  })

})
