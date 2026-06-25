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

describe('cli dedup merge reconciliation', () => {
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

})
