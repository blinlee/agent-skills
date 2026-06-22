import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { contentDedupIndexPath, createContentDedupStore } from '../../src/intake/content-dedup-store.js'
import { embeddingCachePath, loadEmbeddingCache, makeEmbeddingRecord, textSha256, writeEmbeddingCache } from '../../src/retrieval/embedding-cache.js'
import { ensureSqliteTableColumns } from '../../src/shared/sqlite-schema.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('SQLite schema drift repair', () => {
  it('adds missing columns to an existing SQLite table', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-sqlite-schema-'))
    tempRoots.push(root)
    const dbPath = path.join(root, 'state.db')
    const db = new Database(dbPath)
    try {
      db.exec('CREATE TABLE records (id TEXT PRIMARY KEY)')
      ensureSqliteTableColumns(db, 'records', [
        { name: 'title', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'score', definition: 'REAL' },
      ])
      const columns = db.prepare('PRAGMA table_info(records)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toEqual(['id', 'title', 'score'])
    } finally {
      db.close()
    }
  })

  it('repairs old embedding cache tables through the normal write/read path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-embedding-drift-'))
    tempRoots.push(root)
    const config = { provider: 'local-http' as const, model: 'bge-m3' }
    const cachePath = embeddingCachePath(root, config)
    const dbPath = cachePath
    await mkdir(path.dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    try {
      db.exec(`
        CREATE TABLE vectors (
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          text_sha256 TEXT NOT NULL,
          chunk_id TEXT NOT NULL,
          dims INTEGER NOT NULL,
          vector BLOB NOT NULL,
          created_at TEXT NOT NULL
        )
      `)
    } finally {
      db.close()
    }

    const record = makeEmbeddingRecord({
      provider: 'local-http',
      model: 'bge-m3',
      textSha256: textSha256('drift repair'),
      chunkId: 'chunk-1',
      pageTarget: 'sources/drift',
      vector: [1, 0],
      createdAt: '2026-06-20T00:00:00.000Z',
    })
    await writeEmbeddingCache(cachePath, [record])
    const loaded = await loadEmbeddingCache(cachePath)

    expect(loaded.records).toEqual([record])
    const repaired = new Database(dbPath)
    try {
      const columns = repaired.prepare('PRAGMA table_info(vectors)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['cache_key', 'page_target']))
    } finally {
      repaired.close()
    }
  })

  it('repairs old content dedup tables through the normal store path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-dedup-drift-'))
    tempRoots.push(root)
    const statePath = contentDedupIndexPath(root)
    const dbPath = statePath
    await mkdir(path.dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    try {
      db.exec(`
        CREATE TABLE dedup_index (
          doc_hash TEXT PRIMARY KEY,
          source_identity TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_url TEXT,
          title TEXT NOT NULL,
          normalized_title TEXT NOT NULL,
          page_id TEXT NOT NULL,
          chunk_count INTEGER NOT NULL DEFAULT 0,
          ingested_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO dedup_index (
          doc_hash, source_identity, source_kind, source_url, title, normalized_title,
          page_id, chunk_count, ingested_at, updated_at
        ) VALUES (
          'hash-1', '/tmp/source.md', 'md', NULL, 'Drift Note', 'drift note',
          'sources/drift-note', 1, '2026-06-20T00:00:00.000Z', '2026-06-20T00:00:00.000Z'
        );
      `)
    } finally {
      db.close()
    }

    const store = createContentDedupStore(statePath)
    const records = await store.listRecords()
    const stats = await store.stats()

    expect(records[0]).toEqual(expect.objectContaining({
      docHash: 'hash-1',
      sourceIdentity: '/tmp/source.md',
      pageId: 'sources/drift-note',
    }))
    expect(stats.recordCount).toBe(1)
    const repaired = new Database(dbPath)
    try {
      const columns = repaired.prepare('PRAGMA table_info(dedup_index)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['embedding_provider', 'embedding_model', 'embedding_vector']))
    } finally {
      repaired.close()
    }
  })
})
