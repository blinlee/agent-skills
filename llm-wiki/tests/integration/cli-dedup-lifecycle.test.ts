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

async function markManifestNeedsReviewAndRemoveReading(knowledgeRoot: string, sourcePath: string) {
  const manifestPath = path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json')
  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as {
    entries: Record<string, { lastStatus?: string; lastOutputManifest?: { pageFiles: string[]; indexEntries: string[] } | null }>
  }
  const entry = manifest.entries[path.resolve(sourcePath)]
  if (!entry?.lastOutputManifest) {
    throw new Error(`Missing dedup manifest entry for ${sourcePath}`)
  }
  entry.lastStatus = 'needs_review'
  entry.lastOutputManifest.pageFiles = entry.lastOutputManifest.pageFiles.filter((filePath) => !filePath.startsWith('wiki/readings/'))
  entry.lastOutputManifest.indexEntries = entry.lastOutputManifest.indexEntries.filter((entryValue) => !entryValue.includes('[[readings/'))
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
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

describe('cli dedup and lifecycle', () => {
  it('skips exact content duplicates across different source paths and records content-dedup logs', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-content-dedup-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const firstPath = path.join(inputRoot, 'duplicate-a.md')
    const secondPath = path.join(inputRoot, 'duplicate-b.md')
    const body = '# Duplicate Knowledge\n\nEntity: DedupAtlas\nConcept: content hygiene\n\nDedupAtlas keeps repeated source material out of retrieval results.\n'
    await writeFile(firstPath, body, 'utf8')
    await writeFile(secondPath, body, 'utf8')

    const first = await runIngestCommandWithCuration({ knowledgeRoot, input: firstPath })
    const second = await runIngestCommandWithCuration({ knowledgeRoot, input: secondPath })
    const contentIndex = readContentDedupSqlite(knowledgeRoot)

    expect(['completed', 'needs_review', 'partial']).toContain(first.status)
    await expect(access(contentDedupDatabasePath(knowledgeRoot))).resolves.toBeUndefined()
    expect(second.status).toBe('completed')
    expect(second.dedupDecision).toEqual({ action: 'skip', reason: 'content-exact-hash' })
    expect(second.writtenFiles).toEqual([])
    expect(contentIndex.records).toHaveLength(1)
    expect(contentIndex.records[0]).toEqual(expect.objectContaining({
      sourceIdentity: path.resolve(firstPath),
      title: 'Duplicate Knowledge',
      pageId: 'sources/duplicate-knowledge',
    }))
    expect(contentIndex.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'record', reason: 'record_success', sourceIdentity: path.resolve(firstPath) }),
      expect.objectContaining({ action: 'skip', reason: 'exact_hash', sourceIdentity: path.resolve(secondPath), matchedSourceIdentity: path.resolve(firstPath) }),
    ]))
  })

  it('backfills content dedup records from existing source manifests without re-ingesting', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-content-backfill-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'old-runtime-source.md')
    await writeFile(sourcePath, '# Old Runtime Source\n\nEntity: BackfillAtlas\nConcept: ledger migration\n\nBackfillAtlas keeps old accepted material visible to the current content ledger.\n', 'utf8')

    const ingested = await runIngestCommandWithCuration({ knowledgeRoot, input: sourcePath })
    await rm(contentDedupDatabasePath(knowledgeRoot), { force: true })
    await removeStoredPageSnapshots(knowledgeRoot, sourcePath)

    const backfill = await runCliFromArgv(['dedup', knowledgeRoot, 'backfill']) as {
      sourceManifest: { migratedEntryCount: number }
      inspected: number
      recorded: number
      skipped: number
      records: Array<{ sourceIdentity: string; pageId: string; status: string; reason?: string }>
    }
    const stats = await runCliFromArgv(['dedup', knowledgeRoot, 'stats']) as {
      stats: { recordCount: number; logCount: number }
    }
    const contentIndex = readContentDedupSqlite(knowledgeRoot)

    expect(['completed', 'needs_review', 'partial']).toContain(ingested.status)
    expect(backfill).toEqual(expect.objectContaining({
      sourceManifest: expect.objectContaining({ migratedEntryCount: 1 }),
      inspected: 1,
      recorded: 1,
      skipped: 0,
    }))
    expect(backfill.records[0]).toEqual(expect.objectContaining({
      sourceIdentity: path.resolve(sourcePath),
      pageId: 'sources/old-runtime-source',
      status: 'recorded',
    }))
    expect(stats.stats.recordCount).toBe(1)
    expect(stats.stats.logCount).toBe(1)
    expect(contentIndex.records).toEqual([
      expect.objectContaining({
        sourceIdentity: path.resolve(sourcePath),
        title: 'Old Runtime Source',
        pageId: 'sources/old-runtime-source',
      }),
    ])
    const sourceManifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json'), 'utf8')) as {
      entries: Record<string, { lastOutputManifest?: { pageSnapshots?: Array<{ filePath: string; body: string }> } | null }>
    }
    expect(sourceManifest.entries[path.resolve(sourcePath)]?.lastOutputManifest?.pageSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'wiki/sources/old-runtime-source.md',
          body: expect.stringContaining('BackfillAtlas keeps old accepted material visible'),
        }),
      ]),
    )
  })

  it('keeps existing needs-review status when maintain backfills missing reading assets', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-maintain-backfill-status-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'review-state.md')
    await writeFile(
      sourcePath,
      '# Review State\n\nThis source has an old review status but needs reading-page backfill.\n',
      'utf8',
    )

    const ingested = await runIngestCommandWithCuration({ knowledgeRoot, input: sourcePath })
    expect(ingested.status).toBe('completed')
    await markManifestNeedsReviewAndRemoveReading(knowledgeRoot, sourcePath)

    await runCliFromArgv(['maintain', knowledgeRoot])

    const manifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json'), 'utf8')) as {
      entries: Record<string, { lastStatus?: string; lastOutputManifest?: { pageFiles: string[] } | null }>
    }
    expect(manifest.entries[path.resolve(sourcePath)]?.lastStatus).toBe('needs_review')
    expect(manifest.entries[path.resolve(sourcePath)]?.lastOutputManifest?.pageFiles).toContain('wiki/readings/review-state.md')
  })

  it('migrates snapshotless source manifests before ordinary changed-source ingest', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-source-manifest-migrate-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'manifest-migration.md')
    await writeFile(
      sourcePath,
      '# Manifest Migration\n\nEntity: MigrationBot\nConcept: manifest hygiene\n\nMigrationBot keeps manifest hygiene visible.\n',
      'utf8',
    )

    const first = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'MigrationBot', quote: 'Entity: MigrationBot' })],
        concepts: [testConcept({ title: 'Manifest Hygiene', quote: 'Concept: manifest hygiene' })],
      }),
    })
    expect(['completed', 'needs_review', 'partial']).toContain(first.status)
    await removeStoredPageSnapshots(knowledgeRoot, sourcePath)
    await writeFile(
      sourcePath,
      '# Manifest Migration Updated\n\nEntity: MigrationBot\nConcept: manifest hygiene\n\nMigrationBot keeps old source manifests ingestable after updates.\n',
      'utf8',
    )

    const second = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'MigrationBot', quote: 'Entity: MigrationBot' })],
        concepts: [testConcept({ title: 'Manifest Hygiene', quote: 'Concept: manifest hygiene' })],
      }),
    })

    expect(second.dedupDecision).toEqual({ action: 'recompile', reason: 'changed' })
    expect(['completed', 'needs_review', 'partial']).toContain(second.status)
    const manifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json'), 'utf8')) as {
      entries: Record<string, { lastOutputManifest?: { pageSnapshots?: Array<{ filePath: string }> } | null }>
    }
    expect(manifest.entries[path.resolve(sourcePath)]?.lastOutputManifest?.pageSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: 'wiki/sources/manifest-migration-updated.md' }),
        expect.objectContaining({ filePath: 'wiki/readings/manifest-migration-updated.md' }),
      ]),
    )
  })

  it('keeps unchanged dedup skips in the previous non-completed ingest status', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-status-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'RAG_for_AIGC_Survey_2024.md')
    await writeFile(
      sourcePath,
      '# Pseduo-Random and de Bruijn Array Codes\n\nThis paper studies de Bruijn array codes and pseudo-random arrays for coding theory.\n',
      'utf8',
    )

    const first = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    const second = await runIngestCommand({ knowledgeRoot, input: sourcePath })

    expect(first.status).toBe('needs_review')
    expect(second.status).toBe('needs_review')
    expect(second.dedupDecision).toBeNull()
    const manifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json'), 'utf8')) as {
      entries: Record<string, { lastStatus?: string }>
    }
    expect(manifest.entries[path.resolve(sourcePath)]?.lastStatus).toBe('needs_review')
  })

  it('retries an unchanged needs-review source when semantic curation is later provided', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-curation-retry-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-inputs-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'compiler-notes.md')
    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic.\n',
      'utf8',
    )

    const first = await runIngestCommand({ knowledgeRoot, input: sourcePath })
    const second = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Compilation', quote: 'Concept: compilation' })],
      }),
    })

    expect(first.status).toBe('needs_review')
    expect(second.status).toBe('completed')
    expect(second.dedupDecision).toEqual({ action: 'recompile', reason: 'inbox-gate-resolved' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).resolves.toBeUndefined()
  })

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

  it('merges duplicate source pages only with explicit confirmation and reconciles dedup records', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-merge-'))
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
      const vector = text.includes('merge two') ? [0.9, 0.4358898943540673] : [1, 0]
      return new Response(JSON.stringify({ data: [{ embedding: vector }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    const firstPath = path.join(inputRoot, 'merge-a.md')
    const secondPath = path.join(inputRoot, 'merge-b.md')
    await writeFile(firstPath, '# Dedup Merge Alpha\n\nEntity: DedupMerge\nConcept: duplicate merge\n\nBaseline document about dedup merge.\n', 'utf8')
    await writeFile(secondPath, '# Dedup Merge Beta\n\nEntity: DedupMerge\nConcept: duplicate merge\n\nmerge two document about duplicate merge with wording changes.\n', 'utf8')

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
    await runIngestCommandWithCuration({ knowledgeRoot, input: secondPath })

    const sourcePageId = 'sources/dedup-merge-beta'
    const targetPageId = 'sources/dedup-merge-alpha'
    const sourcePageFile = path.join(knowledgeRoot, 'wiki', 'sources', 'dedup-merge-beta.md')
    await expect(access(sourcePageFile)).resolves.toBeUndefined()
    await expect(runCliFromArgv([
      'dedup',
      knowledgeRoot,
      'merge',
      sourcePageId,
      targetPageId,
      '--reviewer',
      'tester',
    ])).rejects.toThrow(/dedup merge requires --confirm merge/)
    await expect(access(sourcePageFile)).resolves.toBeUndefined()

    const merged = await runCliFromArgv([
      'dedup',
      knowledgeRoot,
      'merge',
      sourcePageId,
      targetPageId,
      '--confirm',
      'merge',
      '--reviewer',
      'tester',
      '--note',
      'same paper',
    ]) as {
      merge: { mergedPageId: string; updatedRecordCount: number }
      removedPageFile: string
      removedIndexEntry: string
    }
    const contentIndex = readContentDedupSqlite(knowledgeRoot)
    const scan = await runCliFromArgv(['dedup', knowledgeRoot, 'scan']) as { candidates: unknown[] }
    const indexMarkdown = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')

    expect(merged).toEqual(expect.objectContaining({
      merge: expect.objectContaining({
        mergedPageId: targetPageId,
        updatedRecordCount: 1,
      }),
      removedPageFile: 'wiki/sources/dedup-merge-beta.md',
      removedIndexEntry: '- [[sources/dedup-merge-beta|Dedup Merge Beta]]',
    }))
    await expect(access(sourcePageFile)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(contentIndex.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceIdentity: path.resolve(firstPath), pageId: targetPageId }),
      expect.objectContaining({ sourceIdentity: path.resolve(secondPath), pageId: targetPageId }),
    ]))
    expect(contentIndex.logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'merge',
        reason: 'user_override',
        sourceIdentity: path.resolve(secondPath),
        matchedSourceIdentity: path.resolve(firstPath),
      }),
    ]))
    expect(scan.candidates).toEqual([])
    expect(indexMarkdown).toContain('[[sources/dedup-merge-alpha|Dedup Merge Alpha]]')
    expect(indexMarkdown).not.toContain('[[sources/dedup-merge-beta|Dedup Merge Beta]]')
  })

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
  })
})
