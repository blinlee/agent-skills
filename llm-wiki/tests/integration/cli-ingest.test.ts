import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIngestCommand, runIngestInboxCommand, runInitCommand } from '../../src/cli.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('cli ingest', () => {
  it('ingests a markdown file into wiki assets', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    const result = await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    expect(result.status).toBe('needs_review')
    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([expect.stringContaining('wiki/sources')]),
    )
  })

  it('ingests immediate raw/inbox sources as a low-friction vault intake path', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runInitCommand({ knowledgeRoot })
    await writeFile(
      path.join(knowledgeRoot, 'raw', 'inbox', 'alpha.md'),
      '# Inbox Alpha\n\nEntity: AlphaTeam\nConcept: reliability\n\nAlphaTeam keeps reliability visible.\n',
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'raw', 'inbox', 'beta.md'),
      '# Inbox Beta\n\nEntity: BetaTeam\nConcept: observability\n\nBetaTeam keeps observability visible.\n',
      'utf8',
    )

    const result = await runIngestInboxCommand({ knowledgeRoot })

    expect(result.results).toHaveLength(2)
    expect(result.results.map((item) => item.sourceKind)).toEqual(['md', 'md'])
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'inbox-alpha.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'inbox-beta.md'))).resolves.toBeUndefined()
  })

  it('builds chunks and embeddings as part of inbox ingest when a provider is configured', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)
    await stubEmbeddingProvider(path.join(knowledgeRoot, 'embedding-config.json'))

    await runInitCommand({ knowledgeRoot })
    await writeFile(
      path.join(knowledgeRoot, 'raw', 'inbox', 'embedding-alpha.md'),
      '# Embedding Alpha\n\nAlphaTeam studies retrieval pipelines and embedding coverage for source passages.\n',
      'utf8',
    )

    const result = await runIngestInboxCommand({ knowledgeRoot })
    const item = result.results[0]!

    expect(item.index).toEqual(expect.objectContaining({
      status: 'rebuilt',
      chunkCount: expect.any(Number),
      pageCount: expect.any(Number),
    }))
    expect(item.embedding).toEqual(expect.objectContaining({
      status: 'rebuilt',
      provider: 'local-http',
      model: 'test-embed',
      batchCount: expect.any(Number),
      providerRequestCount: expect.any(Number),
      coverage: expect.objectContaining({
        currentChunkCount: item.index!.chunkCount,
        finalVectorCount: item.index!.chunkCount,
        remainingMissingVectorCount: 0,
      }),
    }))
  })
})

async function stubEmbeddingProvider(configPath: string): Promise<void> {
  await writeFile(configPath, JSON.stringify({
    embeddingProvider: {
      provider: 'local-http',
      endpoint: 'http://127.0.0.1:9999/v1/embeddings',
      model: 'test-embed',
      format: 'openai-compatible',
      timeoutMs: 30_000,
    },
  }), 'utf8')
  vi.stubEnv('llm_wiki_config', configPath)
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { input?: string | string[] }
    const inputs = Array.isArray(body.input) ? body.input : [body.input ?? '']
    return new Response(JSON.stringify({
      data: inputs.map((input, index) => ({ index, embedding: vectorFor(String(input)) })),
    }), { status: 200 })
  }))
}

function vectorFor(text: string): number[] {
  return [text.length % 17 + 1, text.charCodeAt(0) % 11 + 1]
}
