import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSqliteTableColumns } from '../shared/sqlite-schema.js';
export function embeddingCacheKey(input) {
    return `${input.provider}:${input.model}:${input.textSha256}`;
}
export function embeddingCacheDirectory(knowledgeRoot, config) {
    return path.join(path.resolve(knowledgeRoot), 'system', 'index', 'embeddings', safeProviderModel(config.provider, config.model));
}
export function embeddingCachePath(knowledgeRoot, config) {
    return embeddingCacheDatabasePath(knowledgeRoot, config);
}
export function embeddingCacheDatabasePath(knowledgeRoot, config) {
    return path.join(embeddingCacheDirectory(knowledgeRoot, config), 'vectors.db');
}
export async function loadEmbeddingCache(filePath) {
    return buildCacheLoadResult(readSqliteEmbeddingCache(filePath) ?? []);
}
export async function writeEmbeddingCache(filePath, records) {
    const sorted = [...records].sort((left, right) => left.cacheKey.localeCompare(right.cacheKey) || left.chunkId.localeCompare(right.chunkId));
    writeSqliteEmbeddingCache(filePath, sorted);
}
export function makeEmbeddingRecord(input) {
    return {
        version: 1,
        provider: input.provider,
        model: input.model,
        textSha256: input.textSha256,
        cacheKey: embeddingCacheKey(input),
        chunkId: input.chunkId,
        pageTarget: input.pageTarget,
        dims: input.vector.length,
        vector: input.vector,
        createdAt: input.createdAt,
    };
}
export function textSha256(text) {
    return createHash('sha256').update(text).digest('hex');
}
function buildCacheLoadResult(records) {
    const recordsByCacheKey = new Map();
    const recordsByTextSha256 = new Map();
    for (const record of records) {
        recordsByCacheKey.set(record.cacheKey, record);
        recordsByTextSha256.set(record.textSha256, record);
    }
    return { records, recordsByCacheKey, recordsByTextSha256 };
}
function readSqliteEmbeddingCache(dbPath) {
    if (!existsSync(dbPath)) {
        return null;
    }
    const db = new Database(dbPath);
    try {
        ensureSqliteEmbeddingSchema(db);
        const rows = db.prepare('SELECT * FROM vectors ORDER BY cache_key, chunk_id').all();
        return rows.map(embeddingRecordFromSqliteRow).filter(isEmbeddingCacheRecord);
    }
    finally {
        db.close();
    }
}
function writeSqliteEmbeddingCache(dbPath, records) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
        db.pragma('journal_mode = WAL');
        ensureSqliteEmbeddingSchema(db);
        const write = db.transaction(() => {
            db.prepare('DELETE FROM vectors').run();
            const insert = db.prepare(`
        INSERT OR REPLACE INTO vectors (
          provider, model, text_sha256, cache_key, chunk_id, page_target, dims, vector, created_at
        ) VALUES (
          @provider, @model, @text_sha256, @cache_key, @chunk_id, @page_target, @dims, @vector, @created_at
        )
      `);
            for (const record of records) {
                insert.run(embeddingRecordToSqliteRow(record));
            }
        });
        write();
    }
    finally {
        db.close();
    }
}
function ensureSqliteEmbeddingSchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS vectors (
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      text_sha256 TEXT NOT NULL,
      cache_key TEXT NOT NULL PRIMARY KEY,
      chunk_id TEXT NOT NULL,
      page_target TEXT NOT NULL,
      dims INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
    ensureSqliteTableColumns(db, 'vectors', [
        { name: 'provider', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'model', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'text_sha256', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'cache_key', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'chunk_id', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'page_target', definition: "TEXT NOT NULL DEFAULT ''" },
        { name: 'dims', definition: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'vector', definition: "BLOB NOT NULL DEFAULT X''" },
        { name: 'created_at', definition: "TEXT NOT NULL DEFAULT ''" },
    ]);
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vectors_text_sha256 ON vectors(text_sha256);
    CREATE INDEX IF NOT EXISTS idx_vectors_chunk ON vectors(chunk_id);
    CREATE INDEX IF NOT EXISTS idx_vectors_provider_model ON vectors(provider, model);
  `);
}
function embeddingRecordToSqliteRow(record) {
    return {
        provider: record.provider,
        model: record.model,
        text_sha256: record.textSha256,
        cache_key: record.cacheKey,
        chunk_id: record.chunkId,
        page_target: record.pageTarget,
        dims: record.dims,
        vector: vectorToBlob(record.vector),
        created_at: record.createdAt,
    };
}
function embeddingRecordFromSqliteRow(row) {
    const vector = vectorFromBlob(row.vector);
    return {
        version: 1,
        provider: row.provider,
        model: row.model,
        textSha256: row.text_sha256,
        cacheKey: row.cache_key,
        chunkId: row.chunk_id,
        pageTarget: row.page_target,
        dims: row.dims,
        vector,
        createdAt: row.created_at,
    };
}
function vectorToBlob(vector) {
    return Buffer.from(new Float32Array(vector).buffer);
}
function vectorFromBlob(blob) {
    const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
    return [...new Float32Array(buffer)];
}
function safeProviderModel(provider, model) {
    const safe = `${provider}-${model}`
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return safe || 'local-http-model';
}
function isEmbeddingCacheRecord(value) {
    return value.version === 1
        && isEmbeddingProviderName(value.provider)
        && typeof value.model === 'string'
        && typeof value.textSha256 === 'string'
        && typeof value.cacheKey === 'string'
        && typeof value.chunkId === 'string'
        && typeof value.pageTarget === 'string'
        && typeof value.dims === 'number'
        && Array.isArray(value.vector)
        && value.vector.length === value.dims
        && value.vector.every((item) => typeof item === 'number' && Number.isFinite(item))
        && typeof value.createdAt === 'string';
}
function isEmbeddingProviderName(value) {
    return value === 'local-http' || value === 'ollama' || value === 'lm-studio' || value === 'custom-endpoint';
}
