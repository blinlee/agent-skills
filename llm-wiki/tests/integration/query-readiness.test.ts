import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBuildIndexCommand, runCliMain, runIngestCommand, runInitCommand, runLintCommand, runQueryCommand, runQueryReadinessCommand, runStatusCommand, runWikiOverviewCommand } from '../../src/cli.js'
import { retrieveChunks } from '../../src/retrieval/retrieval.js'

const tempRoots: string[] = []

afterEach(async () => {
  vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `no-embedding-config-${Date.now()}.json`))
  vi.unstubAllGlobals()
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

function semanticVectorFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('量化')
    || normalized.includes('quantitative research')
    || normalized.includes('factor discovery')
    || normalized.includes('portfolio')
  ) {
    return [1, 0]
  }
  return [0, 1]
}

function semanticDecoyVectorFor(text: string): number[] {
  const normalized = text.toLowerCase()
  if (normalized.includes('量化')) {
    return [1, 0]
  }
  if (normalized.includes('ai software engineering') || normalized.includes('coding agents') || normalized.includes('prompt workflows')) {
    return [0.58, 0.814616]
  }
  return [0, 1]
}

async function qualifySampleCompilerNotesLinks(knowledgeRoot: string): Promise<void> {
  const rewriteIfPresent = async (filePath: string, rewrite: (content: string) => string) => {
    try {
      const content = await readFile(filePath, 'utf8')
      const nextContent = rewrite(content)
      if (nextContent !== content) {
        await writeFile(filePath, nextContent, 'utf8')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  await rewriteIfPresent(
    path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'),
    (content) => content.replace('[[compiler-notes|Compiler Notes]]', '[[sources/compiler-notes|Compiler Notes]]'),
  )
  await rewriteIfPresent(
    path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'),
    (content) => content.replace('[[compiler-notes|Compiler Notes]]', '[[sources/compiler-notes|Compiler Notes]]'),
  )
  await rewriteIfPresent(
    path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'),
    (content) => content
      .replace('[[openclaw|OpenClaw]]', '[[entities/openclaw|OpenClaw]]')
      .replace('[[compiler-notes|Compiler Notes]]', '[[sources/compiler-notes|Compiler Notes]]'),
  )
}

describe('query readiness and source reading pack', () => {
  it('keeps init, status, and lint aligned on fresh-root readiness', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runInitCommand({ knowledgeRoot })

    const status = await runStatusCommand({ knowledgeRoot })
    const lint = await runLintCommand({ knowledgeRoot })

    expect(status.knowledgeRootExists).toBe(true)
    expect(status.requiredDirectories.missing).toEqual([])
    expect(status.requiredFiles.missing).toEqual([])
    expect(lint.status).toBe('ok')
    expect(lint.errors).toEqual([])
  })

  it('initializes a generic schema and reserved Obsidian-friendly wiki surfaces', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    const init = await runInitCommand({ knowledgeRoot })
    const status = await runStatusCommand({ knowledgeRoot })
    const schema = await readFile(path.join(knowledgeRoot, 'wiki', 'SCHEMA.md'), 'utf8')
    const index = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    const log = await readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8')

    expect(init.createdDirectories).toEqual(expect.arrayContaining([
      'assets',
      'wiki/comparisons',
      'wiki/queries',
    ]))
    expect(status.requiredFiles.present).toEqual(expect.arrayContaining(['wiki/SCHEMA.md']))
    expect(status.requiredDirectories.present).toEqual(expect.arrayContaining([
      'assets',
      'wiki/comparisons',
      'wiki/queries',
    ]))
    expect(schema).toContain('# Wiki 结构说明')
    expect(schema).toContain('llm-wiki 会把规范化的原始材料编译成')
    expect(schema).toContain('[[sources/source-slug|Title]]')
    expect(schema).toContain('人在回路分类')
    expect(schema).toContain('High model confidence is not approval')
    expect(index).toBe('# Wiki 索引\n')
    expect(log).toBe('# Wiki 日志\n')
  })

  it('reports query readiness against current chunk hashes and embedding provider metadata', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-query-readiness-'))
    const configPath = path.join(knowledgeRoot, 'embedding-config.json')
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runBuildIndexCommand({ knowledgeRoot })

    const noProvider = await runQueryReadinessCommand({ knowledgeRoot })
    expect(noProvider.kind).toBe('knowledge')
    expect(noProvider.status).toBe('ready')
    if (noProvider.kind === 'knowledge') {
      expect(noProvider.index.status).toBe('current')
      expect(noProvider.embedding.status).toBe('not-configured')
      expect(noProvider.embedding.currentChunkCount).toBeGreaterThan(0)
    }

    await writeFile(configPath, JSON.stringify({
      embeddingProvider: {
        provider: 'local-http',
        endpoint: 'http://127.0.0.1:9999/v1/embeddings',
        model: 'readiness-model',
        format: 'openai-compatible',
      },
    }), 'utf8')
    vi.stubEnv('llm_wiki_config', configPath)

    const missingVectors = await runQueryReadinessCommand({ knowledgeRoot })
    expect(missingVectors.kind).toBe('knowledge')
    if (missingVectors.kind === 'knowledge') {
      expect(missingVectors.status).toBe('embedding-missing')
      expect(missingVectors.embedding).toEqual(expect.objectContaining({
        status: 'missing-vectors',
        provider: 'local-http',
        model: 'readiness-model',
        currentChunkCount: expect.any(Number),
        reusableVectorCount: 0,
      }))
      expect(missingVectors.embedding.currentChunkCount).toBeGreaterThan(0)
      expect(missingVectors.embedding.missingVectorCount).toBe(missingVectors.embedding.currentVectorKeyCount)
      expect(missingVectors.embedding.cachePath).toContain(`${path.sep}vectors.db`)
    }
  })

  it('stops query on stale raw-backed indexes instead of falling back to wiki summaries', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-stale-query-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runBuildIndexCommand({ knowledgeRoot })
    const rawManifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'manifests', 'raw-sources.json'), 'utf8')) as {
      entries: Record<string, { relativePath: string }>
    }
    const rawEntry = Object.values(rawManifest.entries)[0]!
    await appendFile(path.join(knowledgeRoot, rawEntry.relativePath), '\nMUTATED AFTER INDEX\n', 'utf8')

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(answer.retrieval.mode).toBe('stale-index')
    expect(answer.retrieval.messages.join('\n')).toContain('stale-index')
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.citations).toHaveLength(0)
    expect(answer.sourceReadingPack).toEqual(expect.objectContaining({
      answerability: 'insufficient-evidence',
      passageCount: 0,
      passages: [],
    }))
  })

  it('stops query when indexed raw files are deleted after indexing', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-missing-raw-query-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runBuildIndexCommand({ knowledgeRoot })
    const rawManifest = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'manifests', 'raw-sources.json'), 'utf8')) as {
      entries: Record<string, { relativePath: string }>
    }
    const rawEntry = Object.values(rawManifest.entries)[0]!
    await rm(path.join(knowledgeRoot, rawEntry.relativePath), { force: true })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(answer.retrieval.mode).toBe('stale-index')
    expect(answer.retrieval.messages.join('\n')).toContain('indexed raw source missing')
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.citations).toHaveLength(0)
  })

  it('stops query when stale chunks omit rawPath for managed raw-backed source pages', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-stale-chunk-query-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runBuildIndexCommand({ knowledgeRoot })
    const chunksPath = path.join(knowledgeRoot, 'system', 'index', 'chunks.json')
    const chunkState = JSON.parse(await readFile(chunksPath, 'utf8')) as {
      chunks: Array<{ pageTarget: string; rawPath?: string | null; evidenceKind?: 'raw' | 'wiki'; filePath: string }>
    }
    chunkState.chunks = chunkState.chunks.map((chunk) => chunk.pageTarget === 'sources/compiler-notes'
      ? { ...chunk, rawPath: null, evidenceKind: 'wiki', filePath: path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md') }
      : chunk)
    await writeFile(chunksPath, JSON.stringify(chunkState, null, 2), 'utf8')

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(answer.retrieval.mode).toBe('stale-index')
    expect(answer.retrieval.messages.join('\n')).toContain('chunk index is wiki-derived')
    expect(answer.grounding.answerability).toBe('insufficient-evidence')
    expect(answer.citations).toHaveLength(0)
  })

  it('prints sourceReadingPack by default and full query diagnostics only with --full', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-cli-query-output-'))
    tempRoots.push(knowledgeRoot)
    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runBuildIndexCommand({ knowledgeRoot })
    const writes: string[] = []
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    })
    try {
      await runCliMain(['query', knowledgeRoot, 'What is deterministic across the knowledge pipeline?'])
      const defaultOutput = JSON.parse(writes.pop() ?? '{}') as Record<string, unknown>
      expect(defaultOutput).toEqual(expect.objectContaining({
        answerability: 'answered',
        sourceReadingPack: expect.objectContaining({
          passages: expect.arrayContaining([
            expect.objectContaining({
              rawPath: expect.stringContaining(`${path.sep}raw${path.sep}`),
              text: expect.stringMatching(/deterministic|knowledge pipeline/i),
            }),
          ]),
        }),
      }))
      expect(defaultOutput).not.toHaveProperty('retrieval')
      expect(defaultOutput).not.toHaveProperty('citations')

      await runCliMain(['query', knowledgeRoot, 'What is deterministic across the knowledge pipeline?', '--full'])
      const fullOutput = JSON.parse(writes.pop() ?? '{}') as Record<string, unknown>
      expect(fullOutput).toHaveProperty('retrieval')
      expect(fullOutput).toHaveProperty('citations')
      expect(fullOutput).toHaveProperty('sourceReadingPack')
    } finally {
      stdoutSpy.mockRestore()
    }
  })

  it('exposes three-layer query context in the agent reading pack', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-context-layers-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await runBuildIndexCommand({ knowledgeRoot })
    const chunkState = JSON.parse(await readFile(path.join(knowledgeRoot, 'system', 'index', 'chunks.json'), 'utf8')) as {
      chunks: Array<{ chunkId: string; pageTarget: string; pageTitle: string }>
    }
    const compilerChunk = chunkState.chunks.find((chunk) => chunk.pageTarget === 'sources/compiler-notes')!
    await mkdir(path.join(knowledgeRoot, 'system', 'index'), { recursive: true })
    await writeFile(path.join(knowledgeRoot, 'system', 'index', 'key-info.json'), JSON.stringify({
      version: 1,
      schema: 'llm-wiki.key-info.v1',
      records: [{
        pageTarget: compilerChunk.pageTarget,
        chunkId: compilerChunk.chunkId,
        title: compilerChunk.pageTitle,
        summary: 'Compiler Notes keeps compilation deterministic across the knowledge pipeline.',
        key_claims: ['Compilation remains deterministic across the knowledge pipeline.'],
        methodology: ['Use stable compiler notes as source evidence.'],
        evidence: ['The source page states deterministic compilation explicitly.', 'FixtureOnlySignal appears only in key info evidence.'],
        limitations: ['Fixture evidence only.'],
        relations: ['OpenClaw: entity mentioned by source evidence.'],
        open_questions: [],
      }, {
        pageTarget: compilerChunk.pageTarget,
        title: compilerChunk.pageTitle,
        summary: 'PageOnlyDerivedSignal is page-level derived context.',
        key_claims: ['PageOnlyDerivedSignal must not be treated as chunk citation evidence.'],
        methodology: [],
        evidence: [],
        limitations: [],
        relations: [],
        open_questions: [],
      }],
    }, null, 2), 'utf8')
    await runBuildIndexCommand({ knowledgeRoot })
    await runWikiOverviewCommand({ knowledgeRoot })
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'index.md'),
      '# Sources Index\n\n- Compiler Notes: deterministic compilation evidence.',
      'utf8',
    )

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What does Compiler Notes say about deterministic compilation?',
    })

    expect(answer.agentReadingPack.contextLayers.keyInfo).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'sources/compiler-notes',
        chunkId: compilerChunk.chunkId,
        summary: expect.stringContaining('deterministic'),
        keyClaims: ['Compilation remains deterministic across the knowledge pipeline.'],
      }),
      expect.objectContaining({
        target: 'sources/compiler-notes',
        chunkId: undefined,
        summary: expect.stringContaining('PageOnlyDerivedSignal'),
      }),
    ]))
    expect(answer.agentReadingPack.contextLayers.wikiOverview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'wiki-overview',
        excerpt: expect.stringContaining('Compiler Notes'),
      }),
      expect.objectContaining({
        source: 'section-index',
        excerpt: expect.stringContaining('Sources Index'),
      }),
    ]))
    expect(answer.agentReadingPack.contextLayers.ragChunks[0]).toEqual(expect.objectContaining({
      citationIndex: 1,
      target: 'sources/compiler-notes',
      chunkId: expect.any(String),
      excerpt: expect.stringContaining('OpenClaw keeps compilation deterministic'),
    }))

    const keyInfoOnlyAnswer = await runQueryCommand({
      knowledgeRoot,
      question: 'What says FixtureOnlySignal?',
    })
    expect(keyInfoOnlyAnswer.retrieval.mode).toBe('matched')
    expect(keyInfoOnlyAnswer.citations[0]!.excerpt).not.toContain('Key info:')
    expect(keyInfoOnlyAnswer.citations[0]!.excerpt).not.toContain('FixtureOnlySignal appears only in key info evidence.')
    expect(keyInfoOnlyAnswer.citations[0]!.excerpt).not.toContain('PageOnlyDerivedSignal')
    expect(keyInfoOnlyAnswer.agentReadingPack.contextLayers.keyInfo).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chunkId: compilerChunk.chunkId,
        evidence: expect.arrayContaining(['FixtureOnlySignal appears only in key info evidence.']),
      }),
    ]))
    expect(keyInfoOnlyAnswer.grounding.answerability).toBe('insufficient-evidence')
  })
})
