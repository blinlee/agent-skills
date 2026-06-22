import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { ensureSqliteTableColumns } from '../shared/sqlite-schema.js'
import type { SourceKind } from '../types.js'
import type {
  ContentDedupLogEntry,
  ContentDedupPendingDecision,
  ContentDedupRecord,
  ContentDedupState,
  ContentDedupUserDecision,
} from './content-dedup-types.js'

type SqliteRecordRow = {
  doc_hash: string
  source_identity: string
  source_kind: SourceKind
  source_url: string | null
  title: string
  normalized_title: string
  page_id: string
  chunk_count: number
  embedding_provider: string | null
  embedding_model: string | null
  embedding_dims: number | null
  embedding_vector: Buffer | null
  ingested_at: string
  updated_at: string
}

type SqliteLogRow = {
  id: string
  new_doc_hash: string
  matched_doc_hash: string | null
  action: ContentDedupLogEntry['action']
  reason: ContentDedupLogEntry['reason']
  similarity: number | null
  source_identity: string
  matched_source_identity: string | null
  user_decision: ContentDedupUserDecision | null
  created_at: string
}

type SqlitePendingDecisionRow = {
  id: string
  status: ContentDedupPendingDecision['status']
  new_doc_hash: string
  source_identity: string
  source_kind: SourceKind
  source_url: string | null
  title: string
  matched_doc_hash: string
  matched_source_identity: string
  matched_page_id: string
  reason: ContentDedupPendingDecision['reason']
  similarity: number | null
  user_decision: ContentDedupUserDecision | null
  reviewer: string | null
  note: string | null
  created_at: string
  resolved_at: string | null
}

export function readSqliteState(dbPath: string): ContentDedupState | null {
  if (!existsSync(dbPath)) {
    return null
  }

  const db = new Database(dbPath)
  try {
    ensureSqliteSchema(db)
    const records = db.prepare('SELECT * FROM dedup_index ORDER BY doc_hash').all() as SqliteRecordRow[]
    const logs = db.prepare('SELECT * FROM dedup_log ORDER BY created_at, id').all() as SqliteLogRow[]
    const pendingDecisions = db.prepare('SELECT * FROM dedup_pending_decisions ORDER BY created_at, id').all() as SqlitePendingDecisionRow[]
    return {
      version: 1,
      schema: 'llm-wiki.content-dedup.v1',
      records: records.map(recordFromSqliteRow),
      logs: logs.map(logFromSqliteRow),
      pendingDecisions: pendingDecisions.map(pendingDecisionFromSqliteRow),
    }
  } finally {
    db.close()
  }
}

export function writeSqliteState(dbPath: string, state: ContentDedupState): void {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  try {
    db.pragma('journal_mode = WAL')
    ensureSqliteSchema(db)
    const write = db.transaction(() => {
      db.prepare('DELETE FROM dedup_log').run()
      db.prepare('DELETE FROM dedup_pending_decisions').run()
      db.prepare('DELETE FROM dedup_index').run()

      const insertRecord = db.prepare(`
        INSERT INTO dedup_index (
          doc_hash, source_identity, source_kind, source_url, title, normalized_title,
          page_id, chunk_count, embedding_provider, embedding_model, embedding_dims,
          embedding_vector, ingested_at, updated_at
        ) VALUES (
          @doc_hash, @source_identity, @source_kind, @source_url, @title, @normalized_title,
          @page_id, @chunk_count, @embedding_provider, @embedding_model, @embedding_dims,
          @embedding_vector, @ingested_at, @updated_at
        )
      `)
      for (const record of state.records) {
        insertRecord.run(recordToSqliteRow(record))
      }

      const insertPendingDecision = db.prepare(`
        INSERT INTO dedup_pending_decisions (
          id, status, new_doc_hash, source_identity, source_kind, source_url, title,
          matched_doc_hash, matched_source_identity, matched_page_id, reason, similarity,
          user_decision, reviewer, note, created_at, resolved_at
        ) VALUES (
          @id, @status, @new_doc_hash, @source_identity, @source_kind, @source_url, @title,
          @matched_doc_hash, @matched_source_identity, @matched_page_id, @reason, @similarity,
          @user_decision, @reviewer, @note, @created_at, @resolved_at
        )
      `)
      for (const decision of state.pendingDecisions) {
        insertPendingDecision.run(pendingDecisionToSqliteRow(decision))
      }

      const insertLog = db.prepare(`
        INSERT INTO dedup_log (
          id, new_doc_hash, matched_doc_hash, action, reason, similarity,
          source_identity, matched_source_identity, user_decision, created_at
        ) VALUES (
          @id, @new_doc_hash, @matched_doc_hash, @action, @reason, @similarity,
          @source_identity, @matched_source_identity, @user_decision, @created_at
        )
      `)
      for (const log of state.logs) {
        insertLog.run(logToSqliteRow(log))
      }
    })
    write()
  } finally {
    db.close()
  }
}

function ensureSqliteSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dedup_index (
      doc_hash TEXT PRIMARY KEY,
      source_identity TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_url TEXT,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      page_id TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      embedding_provider TEXT,
      embedding_model TEXT,
      embedding_dims INTEGER,
      embedding_vector BLOB,
      ingested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dedup_pending_decisions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      new_doc_hash TEXT NOT NULL,
      source_identity TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_url TEXT,
      title TEXT NOT NULL,
      matched_doc_hash TEXT NOT NULL,
      matched_source_identity TEXT NOT NULL,
      matched_page_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      similarity REAL,
      user_decision TEXT,
      reviewer TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dedup_log (
      id TEXT PRIMARY KEY,
      new_doc_hash TEXT NOT NULL,
      matched_doc_hash TEXT,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      similarity REAL,
      source_identity TEXT NOT NULL,
      matched_source_identity TEXT,
      user_decision TEXT,
      created_at TEXT NOT NULL
    );
  `)
  ensureSqliteTableColumns(db, 'dedup_index', [
    { name: 'doc_hash', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'source_identity', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'source_kind', definition: "TEXT NOT NULL DEFAULT 'unknown'" },
    { name: 'source_url', definition: 'TEXT' },
    { name: 'title', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'normalized_title', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'page_id', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'chunk_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'embedding_provider', definition: 'TEXT' },
    { name: 'embedding_model', definition: 'TEXT' },
    { name: 'embedding_dims', definition: 'INTEGER' },
    { name: 'embedding_vector', definition: 'BLOB' },
    { name: 'ingested_at', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'updated_at', definition: "TEXT NOT NULL DEFAULT ''" },
  ])
  ensureSqliteTableColumns(db, 'dedup_pending_decisions', [
    { name: 'id', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'status', definition: "TEXT NOT NULL DEFAULT 'open'" },
    { name: 'new_doc_hash', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'source_identity', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'source_kind', definition: "TEXT NOT NULL DEFAULT 'unknown'" },
    { name: 'source_url', definition: 'TEXT' },
    { name: 'title', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'matched_doc_hash', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'matched_source_identity', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'matched_page_id', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'reason', definition: "TEXT NOT NULL DEFAULT 'semantic_candidate'" },
    { name: 'similarity', definition: 'REAL' },
    { name: 'user_decision', definition: 'TEXT' },
    { name: 'reviewer', definition: 'TEXT' },
    { name: 'note', definition: 'TEXT' },
    { name: 'created_at', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'resolved_at', definition: 'TEXT' },
  ])
  ensureSqliteTableColumns(db, 'dedup_log', [
    { name: 'id', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'new_doc_hash', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'matched_doc_hash', definition: 'TEXT' },
    { name: 'action', definition: "TEXT NOT NULL DEFAULT 'record'" },
    { name: 'reason', definition: "TEXT NOT NULL DEFAULT 'record_success'" },
    { name: 'similarity', definition: 'REAL' },
    { name: 'source_identity', definition: "TEXT NOT NULL DEFAULT ''" },
    { name: 'matched_source_identity', definition: 'TEXT' },
    { name: 'user_decision', definition: 'TEXT' },
    { name: 'created_at', definition: "TEXT NOT NULL DEFAULT ''" },
  ])
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dedup_index_source_identity ON dedup_index(source_identity);
    CREATE INDEX IF NOT EXISTS idx_dedup_index_source_url ON dedup_index(source_url);
    CREATE INDEX IF NOT EXISTS idx_dedup_index_embedding_model ON dedup_index(embedding_provider, embedding_model);
    CREATE INDEX IF NOT EXISTS idx_dedup_pending_status ON dedup_pending_decisions(status);
    CREATE INDEX IF NOT EXISTS idx_dedup_pending_source ON dedup_pending_decisions(source_identity, new_doc_hash);
    CREATE INDEX IF NOT EXISTS idx_dedup_log_action ON dedup_log(action);
    CREATE INDEX IF NOT EXISTS idx_dedup_log_reason ON dedup_log(reason);
    CREATE INDEX IF NOT EXISTS idx_dedup_log_source ON dedup_log(source_identity);
  `)
}

function recordToSqliteRow(record: ContentDedupRecord): SqliteRecordRow {
  return {
    doc_hash: record.docHash,
    source_identity: record.sourceIdentity,
    source_kind: record.sourceKind,
    source_url: record.sourceUrl,
    title: record.title,
    normalized_title: record.normalizedTitle,
    page_id: record.pageId,
    chunk_count: record.chunkCount,
    embedding_provider: record.embeddingProvider ?? null,
    embedding_model: record.embeddingModel ?? null,
    embedding_dims: record.embeddingDims ?? null,
    embedding_vector: record.embeddingVector ? vectorToBlob(record.embeddingVector) : null,
    ingested_at: record.ingestedAt,
    updated_at: record.updatedAt,
  }
}

function recordFromSqliteRow(row: SqliteRecordRow): ContentDedupRecord {
  return {
    docHash: row.doc_hash,
    sourceIdentity: row.source_identity,
    sourceKind: normalizeSourceKind(row.source_kind),
    sourceUrl: normalizeSourceUrl(row.source_url),
    title: row.title,
    normalizedTitle: row.normalized_title,
    pageId: row.page_id,
    chunkCount: row.chunk_count,
    ...(row.embedding_provider ? { embeddingProvider: row.embedding_provider } : {}),
    ...(row.embedding_model ? { embeddingModel: row.embedding_model } : {}),
    ...(row.embedding_dims ? { embeddingDims: row.embedding_dims } : {}),
    ...(row.embedding_vector ? { embeddingVector: vectorFromBlob(row.embedding_vector) } : {}),
    ingestedAt: row.ingested_at,
    updatedAt: row.updated_at,
  }
}

function pendingDecisionToSqliteRow(decision: ContentDedupPendingDecision): SqlitePendingDecisionRow {
  return {
    id: decision.id,
    status: decision.status,
    new_doc_hash: decision.newDocHash,
    source_identity: decision.sourceIdentity,
    source_kind: decision.sourceKind,
    source_url: decision.sourceUrl,
    title: decision.title,
    matched_doc_hash: decision.matchedDocHash,
    matched_source_identity: decision.matchedSourceIdentity,
    matched_page_id: decision.matchedPageId,
    reason: decision.reason,
    similarity: decision.similarity,
    user_decision: decision.userDecision ?? null,
    reviewer: decision.reviewer ?? null,
    note: decision.note ?? null,
    created_at: decision.createdAt,
    resolved_at: decision.resolvedAt ?? null,
  }
}

function pendingDecisionFromSqliteRow(row: SqlitePendingDecisionRow): ContentDedupPendingDecision {
  return {
    id: row.id,
    status: row.status === 'resolved' ? 'resolved' : 'pending',
    newDocHash: row.new_doc_hash,
    sourceIdentity: row.source_identity,
    sourceKind: normalizeSourceKind(row.source_kind),
    sourceUrl: normalizeSourceUrl(row.source_url),
    title: row.title,
    matchedDocHash: row.matched_doc_hash,
    matchedSourceIdentity: row.matched_source_identity,
    matchedPageId: row.matched_page_id,
    reason: normalizePendingReason(row.reason),
    similarity: row.similarity,
    ...(normalizeUserDecision(row.user_decision) ? { userDecision: normalizeUserDecision(row.user_decision)! } : {}),
    ...(row.reviewer ? { reviewer: row.reviewer } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.created_at,
    ...(row.resolved_at ? { resolvedAt: row.resolved_at } : {}),
  }
}

function logToSqliteRow(log: ContentDedupLogEntry): SqliteLogRow {
  return {
    id: log.id,
    new_doc_hash: log.newDocHash,
    matched_doc_hash: log.matchedDocHash,
    action: log.action,
    reason: log.reason,
    similarity: log.similarity,
    source_identity: log.sourceIdentity,
    matched_source_identity: log.matchedSourceIdentity,
    user_decision: log.userDecision ?? null,
    created_at: log.createdAt,
  }
}

function logFromSqliteRow(row: SqliteLogRow): ContentDedupLogEntry {
  return {
    id: row.id,
    newDocHash: row.new_doc_hash,
    matchedDocHash: row.matched_doc_hash,
    action: normalizeLogAction(row.action),
    reason: normalizeLogReason(row.reason),
    similarity: row.similarity,
    sourceIdentity: row.source_identity,
    matchedSourceIdentity: row.matched_source_identity,
    ...(normalizeUserDecision(row.user_decision) ? { userDecision: normalizeUserDecision(row.user_decision)! } : {}),
    createdAt: row.created_at,
  }
}

function vectorToBlob(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer)
}

function vectorFromBlob(blob: Buffer): number[] {
  const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength)
  return [...new Float32Array(buffer)]
}

function normalizeSourceKind(value: unknown): SourceKind {
  return value === 'md' || value === 'txt' || value === 'url' || value === 'repo' ? value : 'md'
}

function normalizeSourceUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim()) ? value.trim() : null
}

function normalizeLogAction(value: string): ContentDedupLogEntry['action'] {
  return value === 'skip' || value === 'candidate' || value === 'record' || value === 'pending' || value === 'decision' || value === 'merge' ? value : 'candidate'
}

function normalizeLogReason(value: string): ContentDedupLogEntry['reason'] {
  return value === 'exact_hash'
    || value === 'semantic_0.98'
    || value === 'semantic_0.88'
    || value === 'record_success'
    || value === 'url_match'
    || value === 'title_match'
    || value === 'user_override'
    ? value
    : 'title_match'
}

function normalizePendingReason(value: unknown): ContentDedupPendingDecision['reason'] {
  return value === 'semantic_0.88' || value === 'url_match' || value === 'title_match' ? value : 'semantic_0.88'
}

function normalizeUserDecision(value: unknown): ContentDedupUserDecision | null {
  return value === 'skip' || value === 'update' || value === 'keep_both' || value === 'ingest' ? value : null
}
