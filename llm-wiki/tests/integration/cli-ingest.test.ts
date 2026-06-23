import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runIngestCommand, runIngestInboxCommand, runInitCommand } from '../../src/cli.js'
import { runIngestCommandWithCuration, testConcept, testEntity, writeTestCurationPlan, writeTestQualityPlan } from '../helpers/curation.js'

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

    const result = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
      curationPath: await writeTestCurationPlan({
        sourcePath: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Compilation', quote: 'Concept: compilation' })],
      }),
    })

    expect(result.status).toBe('completed')
    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([
        expect.stringContaining('wiki/sources'),
        expect.stringContaining('wiki/readings'),
        expect.stringContaining('wiki/entities/openclaw.md'),
        expect.stringContaining('wiki/concepts/compilation.md'),
      ]),
    )
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'compiler-notes.md'))).resolves.toBeUndefined()
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8')).resolves.toContain('[[readings/compiler-notes|完整原文]]')
  })

  it('ingests immediate raw/inbox sources as a low-friction vault intake path', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runInitCommand({ knowledgeRoot })
    const alphaPath = path.join(knowledgeRoot, 'raw', 'inbox', 'alpha.md')
    const betaPath = path.join(knowledgeRoot, 'raw', 'inbox', 'beta.md')
    await writeFile(
      alphaPath,
      '# Inbox Alpha\n\nEntity: AlphaTeam\nConcept: reliability\n\nAlphaTeam keeps reliability visible.\n',
      'utf8',
    )
    await writeFile(
      betaPath,
      '# Inbox Beta\n\nEntity: BetaTeam\nConcept: observability\n\nBetaTeam keeps observability visible.\n',
      'utf8',
    )
    await writeTestCurationPlan({
      sourcePath: alphaPath,
      curationPath: `${alphaPath}.curation.json`,
      entities: [testEntity({ title: 'AlphaTeam', quote: 'Entity: AlphaTeam' })],
      concepts: [testConcept({ title: 'Reliability', quote: 'Concept: reliability' })],
    })
    await writeTestQualityPlan({
      sourcePath: alphaPath,
      qualityPath: `${alphaPath}.quality.json`,
    })
    await writeTestCurationPlan({
      sourcePath: betaPath,
      curationPath: `${betaPath}.curation.json`,
      entities: [testEntity({ title: 'BetaTeam', quote: 'Entity: BetaTeam' })],
      concepts: [testConcept({ title: 'Observability', quote: 'Concept: observability' })],
    })
    await writeTestQualityPlan({
      sourcePath: betaPath,
      qualityPath: `${betaPath}.quality.json`,
    })

    const result = await runIngestInboxCommand({ knowledgeRoot })

    expect(result.results).toHaveLength(2)
    expect(result.results.map((item) => item.sourceKind)).toEqual(['md', 'md'])
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'inbox-alpha.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'inbox-beta.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'inbox-alpha.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'alphateam.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'reliability.md'))).resolves.toBeUndefined()
  })

  it('requires an explicit inbox quality plan before completing ingest', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-quality-required-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourcePath = path.join(inputRoot, 'quality-required.md')
    await writeFile(
      sourcePath,
      '# Quality Required\n\nThis source contains useful retrieval workflow evidence.\n',
      'utf8',
    )
    const curationPath = await writeTestCurationPlan({ sourcePath, baseDir: knowledgeRoot })

    const result = await runIngestCommand({ knowledgeRoot, input: sourcePath, curationPath })

    expect(result.status).toBe('needs_review')
    expect(result.reviewFiles).toEqual(expect.arrayContaining([
      expect.stringContaining(path.join('review', 'quality')),
    ]))
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'quality-required.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('blocks rejected material at the inbox quality gate', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-quality-reject-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const sourcePath = path.join(inputRoot, 'low-value.md')
    await writeFile(
      sourcePath,
      '# Low Value\n\nThis is a transient scratch note without durable wiki value.\n',
      'utf8',
    )
    const qualityPath = await writeTestQualityPlan({
      sourcePath,
      baseDir: knowledgeRoot,
      decision: 'reject',
      reason: '这只是临时草稿，没有稳定知识价值。',
      knowledgeValue: 'none',
    })
    const curationPath = await writeTestCurationPlan({ sourcePath, baseDir: knowledgeRoot })

    const result = await runIngestCommand({ knowledgeRoot, input: sourcePath, qualityPath, curationPath })

    expect(result.status).toBe('needs_review')
    expect(result.reviewFiles).toEqual(expect.arrayContaining([
      expect.stringContaining(path.join('review', 'quality')),
    ]))
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'low-value.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not let content dedup skip bypass a missing inbox quality plan', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-quality-dedup-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const firstPath = path.join(inputRoot, 'first.md')
    const secondPath = path.join(inputRoot, 'second.md')
    const body = '# Repeated Source\n\nRepeated source material still needs quality review before dedup can close it.\n'
    await writeFile(firstPath, body, 'utf8')
    await writeFile(secondPath, body, 'utf8')

    const first = await runIngestCommandWithCuration({ knowledgeRoot, input: firstPath })
    const secondCuration = await writeTestCurationPlan({ sourcePath: secondPath, baseDir: knowledgeRoot })
    const second = await runIngestCommand({ knowledgeRoot, input: secondPath, curationPath: secondCuration })

    expect(first.status).toBe('completed')
    expect(second.status).toBe('needs_review')
    expect(second.dedupDecision).toBeNull()
    expect(second.reviewFiles).toEqual(expect.arrayContaining([
      expect.stringContaining(path.join('review', 'quality')),
    ]))
  })

  it('does not overwrite existing hand-written semantic pages during ingest', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    await runInitCommand({ knowledgeRoot })
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'),
      '# OpenClaw\n\nManual entity note must stay.\n',
      'utf8',
    )

    const sourcePath = path.join(inputRoot, 'compiler-notes.md')
    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic.\n',
      'utf8',
    )

    const result = await runIngestCommandWithCuration({
      knowledgeRoot,
      input: sourcePath,
      curationPath: await writeTestCurationPlan({
        sourcePath,
        baseDir: knowledgeRoot,
        entities: [testEntity({ title: 'OpenClaw', quote: 'Entity: OpenClaw' })],
        concepts: [testConcept({ title: 'Compilation', quote: 'Concept: compilation' })],
      }),
    })

    expect(result.status).toBe('completed')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8'))
      .resolves.toContain('Manual entity note must stay.')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw-compiler-notes.md'), 'utf8'))
      .resolves.toContain('[[sources/compiler-notes|Compiler Notes]]')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8'))
      .resolves.toContain('[[entities/openclaw-compiler-notes|OpenClaw]]')

    const dedupManifest = JSON.parse(
      await readFile(path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json'), 'utf8'),
    ) as {
      entries: Record<string, {
        lastOutputManifest: {
          pageFiles: string[]
        }
      }>
    }
    const pageFiles = dedupManifest.entries[path.resolve(sourcePath)]?.lastOutputManifest.pageFiles ?? []
    expect(pageFiles).not.toContain('wiki/entities/openclaw.md')
    expect(pageFiles).toContain('wiki/entities/openclaw-compiler-notes.md')
  })

  it('merges repeated managed semantic pages across sources', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-merge-semantic-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)

    const alphaPath = path.join(inputRoot, 'alpha.md')
    const betaPath = path.join(inputRoot, 'beta.md')
    await writeFile(alphaPath, '# Alpha\n\nRetrieval systems use source-backed context.\n', 'utf8')
    await writeFile(betaPath, '# Beta\n\nRetrieval systems need careful context windows.\n', 'utf8')

    const alphaPlan = await writeTestCurationPlan({
      sourcePath: alphaPath,
      baseDir: knowledgeRoot,
      concepts: [testConcept({ title: 'Retrieval Systems', quote: 'Retrieval systems use source-backed context.' })],
    })
    const alphaQualityPlan = await writeTestQualityPlan({ sourcePath: alphaPath, baseDir: knowledgeRoot })
    const betaPlan = await writeTestCurationPlan({
      sourcePath: betaPath,
      baseDir: knowledgeRoot,
      concepts: [testConcept({ title: 'Retrieval Systems', quote: 'Retrieval systems need careful context windows.' })],
    })
    const betaQualityPlan = await writeTestQualityPlan({ sourcePath: betaPath, baseDir: knowledgeRoot })

    const alpha = await runIngestCommand({ knowledgeRoot, input: alphaPath, qualityPath: alphaQualityPlan, curationPath: alphaPlan })
    const beta = await runIngestCommand({ knowledgeRoot, input: betaPath, qualityPath: betaQualityPlan, curationPath: betaPlan })

    expect(alpha.status).toBe('completed')
    expect(beta.status).toBe('completed')
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'retrieval-systems.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'retrieval-systems-beta.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'alpha.md'), 'utf8')).resolves.toContain('[[concepts/retrieval-systems|Retrieval Systems]]')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'beta.md'), 'utf8')).resolves.toContain('[[concepts/retrieval-systems|Retrieval Systems]]')
    const conceptPage = await readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'retrieval-systems.md'), 'utf8')
    expect(conceptPage).toContain('[[sources/alpha|Alpha]]')
    expect(conceptPage).toContain('[[sources/beta|Beta]]')
    expect(conceptPage).toContain('Retrieval systems use source-backed context.')
    expect(conceptPage).toContain('Retrieval systems need careful context windows.')
  })

  it('does not turn marker-like source text into semantic pages without explicit curation entries', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-no-marker-heuristic-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'marker-text.md')
    await writeFile(
      sourcePath,
      '# Marker Text\n\nEntity: NotAutomatic\nConcept: not automatic\n\nNotAutomatic should stay plain text unless semantic curation accepts it.\n',
      'utf8',
    )

    const result = await runIngestCommandWithCuration({ knowledgeRoot, input: sourcePath })

    expect(result.status).toBe('completed')
    await expect(access(path.join(knowledgeRoot, 'wiki', 'sources', 'marker-text.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'readings', 'marker-text.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'notautomatic.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'not-automatic.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recompiles unchanged sources when semantic curation is updated explicitly', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-recuration-'))
    const inputRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-input-'))
    tempRoots.push(knowledgeRoot, inputRoot)
    const sourcePath = path.join(inputRoot, 'agent-curation.md')
    await writeFile(
      sourcePath,
      '# Agent Curation\n\nOpenClaw keeps semantic curation explicit and source-backed.\n',
      'utf8',
    )

    const sparsePlan = await writeTestCurationPlan({
      sourcePath,
      baseDir: knowledgeRoot,
      notes: ['本轮只建立 source/readings，不建立语义页。'],
    })
    const qualityPlan = await writeTestQualityPlan({ sourcePath, baseDir: knowledgeRoot })
    const sparse = await runIngestCommand({ knowledgeRoot, input: sourcePath, qualityPath: qualityPlan, curationPath: sparsePlan })
    expect(sparse.status).toBe('completed')
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const curatedPlan = await writeTestCurationPlan({
      sourcePath,
      baseDir: knowledgeRoot,
      entities: [testEntity({ title: 'OpenClaw', kind: 'system', quote: 'OpenClaw keeps semantic curation explicit and source-backed.' })],
      concepts: [testConcept({ title: 'Semantic Curation', quote: 'semantic curation explicit and source-backed' })],
    })
    const skipped = await runIngestCommand({ knowledgeRoot, input: sourcePath, qualityPath: qualityPlan, curationPath: curatedPlan })
    expect(skipped.dedupDecision).toEqual({ action: 'skip', reason: 'unchanged' })
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).rejects.toMatchObject({ code: 'ENOENT' })

    const recompiled = await runIngestCommand({
      knowledgeRoot,
      input: sourcePath,
      qualityPath: qualityPlan,
      curationPath: curatedPlan,
      forceRecompile: true,
    })
    expect(recompiled.dedupDecision).toEqual({ action: 'recompile', reason: 'forced-recompile' })
    expect(recompiled.status).toBe('completed')
    await expect(access(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'))).resolves.toBeUndefined()
    await expect(access(path.join(knowledgeRoot, 'wiki', 'concepts', 'semantic-curation.md'))).resolves.toBeUndefined()
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'agent-curation.md'), 'utf8')).resolves.toContain('[[entities/openclaw|OpenClaw]]')
  })

  it('builds chunks and embeddings as part of inbox ingest when a provider is configured', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)
    await stubEmbeddingProvider(path.join(knowledgeRoot, 'embedding-config.json'))

    await runInitCommand({ knowledgeRoot })
    const inboxSourcePath = path.join(knowledgeRoot, 'raw', 'inbox', 'embedding-alpha.md')
    await writeFile(
      inboxSourcePath,
      '# Embedding Alpha\n\nAlphaTeam studies retrieval pipelines and embedding coverage for source passages.\n',
      'utf8',
    )
    await writeTestCurationPlan({ sourcePath: inboxSourcePath, curationPath: `${inboxSourcePath}.curation.json` })
    await writeTestQualityPlan({ sourcePath: inboxSourcePath, qualityPath: `${inboxSourcePath}.quality.json` })

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
