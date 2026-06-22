import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runBuildIndexCommand, runCliFromArgv, runIngestCommand, runInitCommand } from '../../src/cli.js'
import { formatManagedRawFile, hashRawBody } from '../../src/intake/raw-store.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('wiki index', () => {
  it('builds page, chunk, link, and backlink indexes for a wiki root', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const pages = JSON.parse(await readFile(result.files.pages, 'utf8')) as { pages: Array<{ target: string; headings: string[]; outgoingLinks: string[] }> }
    const chunks = JSON.parse(await readFile(result.files.chunks, 'utf8')) as { version: number; schema: string; chunkingSchema?: string; parentSpans?: Array<{ parentSpanId: string; pageTarget: string; rawPath?: string | null; childChunkIds: string[]; splitStrategy: string; text: string }>; chunks: Array<{ chunkId: string; parentSpanId?: string; pageTarget: string; pageTitle: string; filePath: string; rawPath?: string | null; evidenceKind?: string; heading: string; headingPath: string[]; startLine: number; endLine: number; startOffset?: number; endOffset?: number; parentStartLine?: number; parentEndLine?: number; prevChunkId?: string | null; nextChunkId?: string | null; sourceBlockRefs?: string[]; text: string; textSha256: string; tokenCountApprox: number; sourceRef: string | null; links: string[] }> }
    const lexical = JSON.parse(await readFile(result.files.lexical, 'utf8')) as { version: number; schema: string; chunkIndexVersion: number; chunkCount: number; terms: Record<string, { df: number; postings: Array<{ chunkId: string; tf: number }> }> }
    const links = JSON.parse(await readFile(result.files.links, 'utf8')) as { links: Array<{ from: string; to: string | null; status: string }>; backlinks: Record<string, string[]> }
    const topics = JSON.parse(await readFile(result.files.topics, 'utf8')) as { version: number; schema: string; topics: Array<{ slug: string; name: string; chunkIds: string[]; pageTargets: string[]; sourceRefs: string[] }> }

    expect(result.pageCount).toBeGreaterThan(0)
    expect(result.chunkCount).toBeGreaterThan(0)
    expect(pages.pages.map((page) => page.target)).toContain('sources/compiler-notes')
    const compilerChunk = chunks.chunks.find((chunk) => chunk.pageTarget === 'sources/compiler-notes' && /Compiler Notes/.test(chunk.text))
    expect(chunks.version).toBe(2)
    expect(chunks.schema).toBe('llm-wiki.chunks.v2')
    expect(chunks.chunkingSchema).toBe('llm-wiki.parent-child.v1')
    expect(compilerChunk).toMatchObject({
      chunkId: expect.stringMatching(/^sha256:/),
      parentSpanId: expect.stringMatching(/^sha256:/),
      pageTitle: 'Compiler Notes',
      heading: 'Compiler Notes',
      headingPath: ['Compiler Notes'],
      startLine: expect.any(Number),
      endLine: expect.any(Number),
      startOffset: expect.any(Number),
      endOffset: expect.any(Number),
      parentStartLine: expect.any(Number),
      parentEndLine: expect.any(Number),
      textSha256: expect.any(String),
      tokenCountApprox: expect.any(Number),
      sourceRef: expect.any(String),
      rawPath: expect.stringContaining(`${path.sep}raw${path.sep}`),
      evidenceKind: 'raw',
      links: expect.any(Array),
      sourceBlockRefs: expect.any(Array),
    })
    expect(compilerChunk!.filePath).toBe(compilerChunk!.rawPath)
    const compilerParent = chunks.parentSpans?.find((span) => span.parentSpanId === compilerChunk?.parentSpanId)
    expect(compilerParent).toMatchObject({
      pageTarget: 'sources/compiler-notes',
      rawPath: compilerChunk!.rawPath,
      childChunkIds: expect.arrayContaining([compilerChunk!.chunkId]),
      splitStrategy: expect.stringMatching(/structure|window-fallback/),
    })
    expect(compilerParent!.text).toContain(compilerChunk!.text)
    expect(lexical).toMatchObject({
      version: 1,
      schema: 'llm-wiki.lexical.v1',
      chunkIndexVersion: 2,
      chunkCount: result.chunkCount,
    })
    expect(lexical.terms.compiler?.postings.some((posting) => posting.chunkId === compilerChunk?.chunkId)).toBe(true)
    expect(links.links.some((link) => link.from === 'entities/openclaw')).toBe(false)
    expect(links.backlinks['sources/compiler-notes'] ?? []).not.toContain('entities/openclaw')
    expect(topics).toMatchObject({ version: 1, schema: 'llm-wiki.topics.v1' })
    expect(topics.topics.every((topic) => topic.chunkIds.length > 0 && topic.pageTargets.length > 0)).toBe(true)

    const secondResult = await runBuildIndexCommand({ knowledgeRoot })
    const secondChunks = JSON.parse(await readFile(secondResult.files.chunks, 'utf8')) as typeof chunks
    const reusedCompilerChunk = secondChunks.chunks.find((chunk) => chunk.pageTarget === 'sources/compiler-notes' && /Compiler Notes/.test(chunk.text))
    expect(reusedCompilerChunk!.filePath).toBe(reusedCompilerChunk!.rawPath)
  })

  it('splits long sections into overlapping 512 character chunks', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-overlap-'))
    tempRoots.push(knowledgeRoot)
    await runInitCommand({ knowledgeRoot })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'sources'), { recursive: true })
    const longBody = `${'a'.repeat(500)}BOUNDARY${'b'.repeat(160)}`
    await writeFile(path.join(knowledgeRoot, 'wiki', 'sources', 'long-overlap.md'), [
      '---',
      'title: "Long Overlap"',
      'type: "source"',
      'sources: ["fixture"]',
      '---',
      '# Long Overlap',
      '',
      longBody,
      '',
    ].join('\n'), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '# Wiki 索引\n\n- [[sources/long-overlap|Long Overlap]]\n', 'utf8')

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const chunks = JSON.parse(await readFile(result.files.chunks, 'utf8')) as { parentSpans?: Array<{ parentSpanId: string; childChunkIds: string[] }>; chunks: Array<{ chunkId: string; parentSpanId?: string; pageTarget: string; text: string; prevChunkId?: string | null; nextChunkId?: string | null }> }
    const pageChunks = chunks.chunks.filter((chunk) => chunk.pageTarget === 'sources/long-overlap')

    expect(pageChunks.length).toBeGreaterThan(1)
    expect(pageChunks.every((chunk) => chunk.text.length <= 512)).toBe(true)
    expect(pageChunks[1]!.text.slice(0, 64)).toBe(pageChunks[0]!.text.slice(-64))
    expect(pageChunks[0]!.nextChunkId).toBe(pageChunks[1]!.chunkId)
    expect(pageChunks[1]!.prevChunkId).toBe(pageChunks[0]!.chunkId)
    const parent = chunks.parentSpans?.find((span) => span.parentSpanId === pageChunks[0]!.parentSpanId)
    expect(parent?.childChunkIds).toEqual(expect.arrayContaining(pageChunks.map((chunk) => chunk.chunkId)))
    expect(new Set(pageChunks.map((chunk) => chunk.chunkId)).size).toBe(pageChunks.length)
  })

  it('preserves window-local line ranges and links for long section chunks', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-window-links-'))
    tempRoots.push(knowledgeRoot)
    await runInitCommand({ knowledgeRoot })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'sources'), { recursive: true })
    await writeFile(path.join(knowledgeRoot, 'wiki', 'sources', 'window-links.md'), [
      '---',
      'title: "Window Links"',
      'type: "source"',
      'sources: ["fixture"]',
      '---',
      '# Window Links',
      '',
      'Opening evidence references [[concepts/alpha|Alpha Link]].',
      'a'.repeat(520),
      'Tail evidence references [[concepts/beta|Beta Link]].',
      '',
    ].join('\n'), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '# Wiki 索引\n\n- [[sources/window-links|Window Links]]\n', 'utf8')

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const chunks = JSON.parse(await readFile(result.files.chunks, 'utf8')) as { chunks: Array<{ pageTarget: string; text: string; startLine: number; endLine: number; links: string[] }> }
    const pageChunks = chunks.chunks.filter((chunk) => chunk.pageTarget === 'sources/window-links')

    expect(pageChunks.length).toBeGreaterThan(1)
    expect(pageChunks[0]).toEqual(expect.objectContaining({
      startLine: 6,
      endLine: 9,
      links: ['concepts/alpha'],
    }))
    expect(pageChunks.at(-1)).toEqual(expect.objectContaining({
      startLine: 9,
      endLine: 10,
      links: ['concepts/beta'],
    }))
    expect(pageChunks[0]!.links).not.toContain('concepts/beta')
    expect(pageChunks.at(-1)!.links).not.toContain('concepts/alpha')
  })

  it('reuses unchanged page artifacts through file hash precheck', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-hash-precheck-'))
    tempRoots.push(knowledgeRoot)
    await runInitCommand({ knowledgeRoot })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'sources'), { recursive: true })
    const firstPath = path.join(knowledgeRoot, 'wiki', 'sources', 'first.md')
    const secondPath = path.join(knowledgeRoot, 'wiki', 'sources', 'second.md')
    await writeFile(firstPath, '# First\n\nFirst page links to [[sources/second|Second]].\n', 'utf8')
    await writeFile(secondPath, '# Second\n\nSecond page evidence.\n', 'utf8')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), [
      '# Wiki 索引',
      '',
      '- [[sources/first|First]]',
      '- [[sources/second|Second]]',
      '',
    ].join('\n'), 'utf8')

    const first = await runBuildIndexCommand({ knowledgeRoot })
    const firstHashes = JSON.parse(await readFile(first.files.fileHashes, 'utf8')) as { files: Record<string, { reused: boolean }> }
    const second = await runBuildIndexCommand({ knowledgeRoot })
    const secondHashes = JSON.parse(await readFile(second.files.fileHashes, 'utf8')) as { files: Record<string, { reused: boolean }> }

    expect(first.reusedPageCount).toBe(0)
    expect(first.rebuiltPageCount).toBe(2)
    expect(firstHashes.files['sources/first']?.reused).toBe(false)
    expect(second.reusedPageCount).toBe(2)
    expect(second.rebuiltPageCount).toBe(0)
    expect(secondHashes.files['sources/first']?.reused).toBe(true)
    expect(secondHashes.files['sources/second']?.reused).toBe(true)

    await writeFile(secondPath, '# Second\n\nSecond page evidence changed.\n', 'utf8')
    const third = await runBuildIndexCommand({ knowledgeRoot })
    const thirdHashes = JSON.parse(await readFile(third.files.fileHashes, 'utf8')) as { files: Record<string, { reused: boolean }> }

    expect(third.reusedPageCount).toBe(1)
    expect(third.rebuiltPageCount).toBe(1)
    expect(thirdHashes.files['sources/first']?.reused).toBe(true)
    expect(thirdHashes.files['sources/second']?.reused).toBe(false)
  })

  it('revalidates reused page links when a previously resolved target becomes missing', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-hash-missing-target-'))
    tempRoots.push(knowledgeRoot)
    await runInitCommand({ knowledgeRoot })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'sources'), { recursive: true })
    const firstPath = path.join(knowledgeRoot, 'wiki', 'sources', 'first.md')
    const secondPath = path.join(knowledgeRoot, 'wiki', 'sources', 'second.md')
    await writeFile(firstPath, '# First\n\nFirst page links to [[sources/second|Second]].\n', 'utf8')
    await writeFile(secondPath, '# Second\n\nSecond page evidence.\n', 'utf8')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'index.md'), [
      '# Wiki 索引',
      '',
      '- [[sources/first|First]]',
      '- [[sources/second|Second]]',
      '',
    ].join('\n'), 'utf8')

    const first = await runBuildIndexCommand({ knowledgeRoot })
    const firstLinks = JSON.parse(await readFile(first.files.links, 'utf8')) as { links: Array<{ from: string; to: string | null; status: string }>; backlinks: Record<string, string[]> }
    expect(firstLinks.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'sources/first', to: 'sources/second', status: 'resolved' }),
    ]))
    expect(firstLinks.backlinks['sources/second']).toContain('sources/first')

    await rm(secondPath)
    const second = await runBuildIndexCommand({ knowledgeRoot })
    const secondPages = JSON.parse(await readFile(second.files.pages, 'utf8')) as { pages: Array<{ target: string; outgoingLinks: string[] }> }
    const secondLinks = JSON.parse(await readFile(second.files.links, 'utf8')) as { links: Array<{ from: string; to: string | null; rawTarget: string; status: string; candidates: string[] }>; backlinks: Record<string, string[]> }

    expect(second.skippedMissingPages).toContain('sources/second')
    expect(second.reusedPageCount).toBe(1)
    expect(second.rebuiltPageCount).toBe(0)
    expect(secondPages.pages.find((page) => page.target === 'sources/first')?.outgoingLinks).not.toContain('sources/second')
    expect(secondLinks.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'sources/first',
        to: null,
        rawTarget: 'sources/second',
        status: 'missing',
        candidates: ['sources/second'],
      }),
    ]))
    expect(secondLinks.backlinks['sources/second'] ?? []).not.toContain('sources/first')
  })

  it('exposes index through the JSON CLI argv surface', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const result = await runCliFromArgv(['index', knowledgeRoot])
    expect(result).toMatchObject({ knowledgeRoot, pageCount: expect.any(Number), chunkCount: expect.any(Number), files: expect.objectContaining({ lexical: expect.stringContaining('lexical.json'), topics: expect.stringContaining('topics.json') }) })
  })

  it('adds reviewable source-to-source semantic links before building the index', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-'))
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-sources-'))
    tempRoots.push(knowledgeRoot, sourceRoot)

    const firstSource = path.join(sourceRoot, 'long-running-agents.md')
    const secondSource = path.join(sourceRoot, 'harness-design.md')
    await writeFile(
      firstSource,
      '# Long Running Agents\n\nLong-running agents need harness design, environment feedback loops, and orchestration.',
      'utf8',
    )
    await writeFile(
      secondSource,
      '# Harness Design for Long Running Agents\n\nHarness design gives long-running agents durable task feedback and orchestration.',
      'utf8',
    )

    await runIngestCommand({ knowledgeRoot, input: firstSource })
    await runIngestCommand({ knowledgeRoot, input: secondSource })

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const links = JSON.parse(await readFile(result.files.links, 'utf8')) as { links: Array<{ from: string; to: string | null; status: string }>; backlinks: Record<string, string[]> }

    expect(result.linkCount).toBeGreaterThan(0)
    expect(links.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'sources/harness-design-for-long-running-agents',
        to: 'sources/long-running-agents',
        status: 'resolved',
      }),
    ]))
    expect(links.backlinks['sources/long-running-agents']).toContain('sources/harness-design-for-long-running-agents')
  })

  it('materializes aliases, redirects, and accepted category edges into topic nodes', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-topics-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'concepts'), { recursive: true })
    await mkdir(path.join(knowledgeRoot, 'taxonomy'), { recursive: true })
    await writeFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compiler-design.md'), '# Compiler Design\n\nCompiler topic node evidence.\n', 'utf8')
    await writeFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'parsing.md'), '# Parsing\n\nParsing topic node evidence.\n', 'utf8')
    await appendFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '- [[concepts/compiler-design|Compiler Design]]\n- [[concepts/parsing|Parsing]]\n', 'utf8')
    await writeFile(path.join(knowledgeRoot, 'taxonomy', 'aliases.json'), JSON.stringify({ aliases: { compilers: 'compiler-design' } }, null, 2), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'taxonomy', 'redirects.json'), JSON.stringify({ redirects: { compiler: 'compiler-design' } }, null, 2), 'utf8')
    await writeFile(path.join(knowledgeRoot, 'taxonomy', 'category-graph.json'), JSON.stringify({
      edges: [
        { from: 'compiler-design', to: 'parsing', type: 'related', status: 'accepted' },
        { from: 'compiler-design', to: 'draft-topic', type: 'related', status: 'proposed' },
      ],
    }, null, 2), 'utf8')

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const topics = JSON.parse(await readFile(result.files.topics, 'utf8')) as { topics: Array<{ slug: string; aliases: string[]; redirectsFrom: string[]; relatedSlugs: string[] }> }
    const compiler = topics.topics.find((topic) => topic.slug === 'compiler-design')!

    expect(compiler.aliases).toContain('compilers')
    expect(compiler.redirectsFrom).toContain('compiler')
    expect(compiler.relatedSlugs).toContain('parsing')
    expect(compiler.relatedSlugs).not.toContain('draft-topic')
  })

  it('indexes the newest raw artifact for repeated source refs instead of preferring older archived state', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-raw-current-'))
    tempRoots.push(knowledgeRoot)
    await runInitCommand({ knowledgeRoot })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'sources'), { recursive: true })
    await mkdir(path.join(knowledgeRoot, 'raw', 'archive'), { recursive: true })
    await mkdir(path.join(knowledgeRoot, 'raw', 'review'), { recursive: true })
    await mkdir(path.join(knowledgeRoot, 'system', 'manifests'), { recursive: true })

    const sourceRef = 'fixture://repeated-source'
    const olderBody = '# Repeated Source\n\nOLD_RAW_SENTINEL should not be indexed.'
    const newerBody = '# Repeated Source\n\nNEW_RAW_SENTINEL should be indexed.'
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'repeated-source.md'),
      [
        '---',
        'title: "Repeated Source"',
        'type: "source"',
        `sources: ["${sourceRef}"]`,
        '---',
        '# Repeated Source',
        '',
        `- 来源引用: ${sourceRef}`,
        '',
      ].join('\n'),
      'utf8',
    )
    await appendFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '- [[sources/repeated-source|Repeated Source]]\n', 'utf8')
    await writeFile(
      path.join(knowledgeRoot, 'raw', 'archive', 'older.md'),
      formatManagedRawFile({ body: olderBody, sourceKind: 'md', sourceRef, jobId: 'older-job', capturedAt: '2026-06-01T00:00:00.000Z' }),
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'raw', 'review', 'newer.md'),
      formatManagedRawFile({ body: newerBody, sourceKind: 'md', sourceRef, jobId: 'newer-job', capturedAt: '2026-06-02T00:00:00.000Z' }),
      'utf8',
    )
    await writeFile(path.join(knowledgeRoot, 'system', 'manifests', 'raw-sources.json'), JSON.stringify({
      entries: {
        'raw/archive/older.md': {
          relativePath: 'raw/archive/older.md',
          sourceKind: 'md',
          sourceRef,
          jobId: 'older-job',
          sha256: hashRawBody(olderBody),
          state: 'archived',
          capturedAt: '2026-06-01T00:00:00.000Z',
          archivedAt: '2026-06-03T00:00:00.000Z',
        },
        'raw/review/newer.md': {
          relativePath: 'raw/review/newer.md',
          sourceKind: 'md',
          sourceRef,
          jobId: 'newer-job',
          sha256: hashRawBody(newerBody),
          state: 'staged',
          capturedAt: '2026-06-02T00:00:00.000Z',
        },
      },
    }, null, 2), 'utf8')

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const chunks = JSON.parse(await readFile(result.files.chunks, 'utf8')) as { chunks: Array<{ pageTarget: string; text: string; rawPath?: string | null }> }
    const repeatedChunk = chunks.chunks.find((chunk) => chunk.pageTarget === 'sources/repeated-source')!

    expect(repeatedChunk.text).toContain('NEW_RAW_SENTINEL')
    expect(repeatedChunk.text).not.toContain('OLD_RAW_SENTINEL')
    expect(repeatedChunk.rawPath).toBe(path.join(knowledgeRoot, 'raw', 'review', 'newer.md'))
  })

  it('skips stale index entries instead of failing the whole index build', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })
    await appendFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '- [[entities/missing-stale|Missing Stale]]\n', 'utf8')
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'stale-link-ledger.md'),
      '# Stale Link Ledger\n\nThis references [[entities/missing-stale|Missing Stale]].\n',
      'utf8',
    )
    await appendFile(path.join(knowledgeRoot, 'wiki', 'index.md'), '- [[sources/stale-link-ledger|Stale Link Ledger]]\n', 'utf8')

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const links = JSON.parse(await readFile(result.files.links, 'utf8')) as { links: Array<{ rawTarget: string; status: string; candidates: string[] }> }

    expect(result.skippedMissingPages).toContain('entities/missing-stale')
    expect(links.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawTarget: 'entities/missing-stale', status: 'missing', candidates: ['entities/missing-stale'] }),
    ]))
  })

})
