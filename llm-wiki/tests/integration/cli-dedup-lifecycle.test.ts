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

})
