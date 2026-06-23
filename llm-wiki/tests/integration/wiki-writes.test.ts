import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCliFromArgv } from '../../src/cli.js'
import { appendWikiLog, updateWikiIndex } from '../../src/wiki/index-log.js'
import { writeKnowledgeChanges } from '../../src/wiki/page-writer.js'
import { runCliIngestWithCuration } from '../helpers/curation.js'

const testRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('wiki writes', () => {
  it('writes source/entity/concept pages and updates index/log', async () => {
    const knowledgeRoot = await createTestRoot()

    const result = await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '...' },
      readingPage: { slug: 'compiler-notes', title: 'Compiler Notes - 完整原文', body: '# Compiler Notes\n\nFull source.' },
      entityPages: [{ slug: 'openclaw', title: 'OpenClaw', body: '...' }],
      conceptPages: [{ slug: 'compilation', title: 'Compilation', body: '...' }],
      synthesisPages: [],
      logEntry: 'ingested compiler-notes',
      indexEntries: ['[[compiler-notes]]'],
    })

    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([
        expect.stringContaining('wiki/sources/compiler-notes.md'),
        expect.stringContaining('wiki/readings/compiler-notes.md'),
        expect.stringContaining('wiki/entities/openclaw.md'),
        expect.stringContaining('wiki/concepts/compilation.md'),
      ]),
    )

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8')).resolves.toContain('type: "source"\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8')).resolves.toContain('# Compiler Notes\n\n...\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'readings', 'compiler-notes.md'), 'utf8')).resolves.toContain('type: "reading"\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'readings', 'compiler-notes.md'), 'utf8')).resolves.toContain('# Compiler Notes\n\nFull source.\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8')).resolves.toContain('type: "entity"\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8')).resolves.toContain('# OpenClaw\n\n...\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), 'utf8')).resolves.toContain('type: "concept"\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), 'utf8')).resolves.toContain('# Compilation\n\n...\n')

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent).toContain('# Wiki 索引')
    expect(indexContent).toContain('## 其他')
    expect(indexContent).toContain('[[compiler-notes]]')

    const logContent = await readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8')
    expect(logContent).toContain('# Wiki 日志')

    const logLines = readLogDataLines(logContent)
    expect(logLines).toHaveLength(1)
    expect(parseLogLineMessage(logLines[0])).toBe('ingested compiler-notes')

    const sourceHistory = await readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes', 'log.md'), 'utf8')
    const entityHistory = await readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw', 'log.md'), 'utf8')
    const conceptHistory = await readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation', 'log.md'), 'utf8')
    expect(sourceHistory).toContain('# Page Log')
    expect(sourceHistory).toContain('"target":"sources/compiler-notes"')
    expect(sourceHistory).toContain('"message":"ingested compiler-notes"')
    expect(entityHistory).toContain('"target":"entities/openclaw"')
    expect(conceptHistory).toContain('"target":"concepts/compilation"')
  })

  it('groups qualified wiki index entries by page type for Obsidian-style navigation', async () => {
    const knowledgeRoot = await createTestRoot()

    await updateWikiIndex(knowledgeRoot, [
      '- [[concepts/compilation|Compilation]]',
      '- [[sources/compiler-notes|Compiler Notes]]',
      '- [[entities/openclaw|OpenClaw]]',
    ])

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')

    expect(indexContent).toMatch(/# Wiki 索引\n\n## 来源\n- \[\[sources\/compiler-notes\|Compiler Notes\]\]\n\n## 实体\n- \[\[entities\/openclaw\|OpenClaw\]\]\n\n## 概念\n- \[\[concepts\/compilation\|Compilation\]\]/)
  })

  it('drops template prose instead of preserving it as an index or log entry', async () => {
    const knowledgeRoot = await createTestRoot()
    await mkdir(path.join(knowledgeRoot, 'wiki'), { recursive: true })

    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'index.md'),
      [
        '# Wiki Index',
        '',
        '> Sectioned catalog for durable wiki pages.',
        '> Generated pages should be linked here.',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'log.md'),
      [
        '# Wiki Log',
        '',
        '> Append-only operation log.',
        '',
      ].join('\n'),
      'utf8',
    )

    await updateWikiIndex(knowledgeRoot, ['- [[sources/compiler-notes|Compiler Notes]]'])
    await appendWikiLog(knowledgeRoot, 'ingested compiler-notes')

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    const logLines = readLogDataLines(await readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8'))

    expect(indexContent).not.toContain('Sectioned catalog')
    expect(indexContent).not.toContain('## Other')
    expect(indexContent).not.toContain('## 其他')
    expect(indexContent).toContain('## 来源')
    expect(logLines).toHaveLength(1)
    expect(parseLogLineMessage(logLines[0])).toBe('ingested compiler-notes')
  })

  it('does not duplicate identical index entries across repeated writes', async () => {
    const knowledgeRoot = await createTestRoot()

    await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '# Compiler Notes\n\nFirst pass.' },
      readingPage: { slug: 'compiler-notes', title: 'Compiler Notes - 完整原文', body: '# Compiler Notes\n\nFull first pass.' },
      entityPages: [],
      conceptPages: [],
      synthesisPages: [],
      logEntry: 'ingested compiler-notes',
      indexEntries: ['[[compiler-notes]]'],
    })

    await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '# Compiler Notes\n\nSecond pass.' },
      readingPage: { slug: 'compiler-notes', title: 'Compiler Notes - 完整原文', body: '# Compiler Notes\n\nFull second pass.' },
      entityPages: [],
      conceptPages: [],
      synthesisPages: [],
      logEntry: 'reingested compiler-notes',
      indexEntries: ['[[compiler-notes]]'],
    })

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent.match(/\[\[compiler-notes\]\]/g)).toHaveLength(1)

    const sourceContent = await readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8')
    expect(sourceContent).toContain('type: "source"\n')
    expect(sourceContent).toContain('# Compiler Notes\n\nSecond pass.\n')

    const logLines = readLogDataLines(await readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8'))
    expect(logLines).toHaveLength(2)
  })

  it('removes stale generated semantic pages from the same source when they are unchanged', async () => {
    const knowledgeRoot = await createTestRoot()

    const firstWrite = await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '# Compiler Notes\n\nFirst pass.' },
      readingPage: { slug: 'compiler-notes', title: 'Compiler Notes - 完整原文', body: '# Compiler Notes\n\nFull first pass.' },
      entityPages: [{ slug: 'openclaw', title: 'OpenClaw', body: '# OpenClaw\n\nGenerated entity from compiler notes.' }],
      conceptPages: [],
      synthesisPages: [],
      logEntry: 'ingested compiler-notes',
      indexEntries: [
        '- [[sources/compiler-notes|Compiler Notes]]',
        '- [[entities/openclaw|OpenClaw]]',
      ],
    })

    await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '# Compiler Notes\n\nSecond pass.' },
      readingPage: { slug: 'compiler-notes', title: 'Compiler Notes - 完整原文', body: '# Compiler Notes\n\nFull second pass.' },
      entityPages: [],
      conceptPages: [],
      synthesisPages: [],
      logEntry: 'reingested compiler-notes',
      indexEntries: ['- [[sources/compiler-notes|Compiler Notes]]'],
      previousOutputManifest: firstWrite.outputManifest,
    })

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent).toContain('[[sources/compiler-notes|Compiler Notes]]')
    expect(indexContent).not.toContain('[[entities/openclaw|OpenClaw]]')
  })

  it('serializes concurrent index and log updates without throwing or losing entries', async () => {
    const knowledgeRoot = await createTestRoot()
    vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000)

    const indexEntries = Array.from({ length: 8 }, (_, index) => `[[entry-${index}]]`)
    const logMessages = Array.from({ length: 8 }, (_, index) => `log ${index}`)

    await expect(
      Promise.all([
        ...indexEntries.map((entry) => updateWikiIndex(knowledgeRoot, [entry])),
        ...logMessages.map((message) => appendWikiLog(knowledgeRoot, message)),
      ]),
    ).resolves.toHaveLength(16)

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    for (const entry of indexEntries) {
      expect(indexContent).toContain(entry)
    }

    const logLines = readLogDataLines(await readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8'))
    expect(logLines).toHaveLength(logMessages.length)
    expect(logLines.map(parseLogLineMessage).sort()).toEqual([...logMessages].sort())
  })

  it('exports wiki pages as an OKF bundle with frontmatter and progressive indexes', async () => {
    const knowledgeRoot = await createTestRoot()
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-okf-export-'))
    testRoots.push(outputDir)

    await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: {
        slug: 'compiler-notes',
        title: 'Compiler Notes',
        body: '# Compiler Notes\n\nCompiler Notes explains deterministic build evidence.\n',
        topics: ['compiler'],
        artifactId: 'raw/compiler-notes.md',
      },
      readingPage: {
        slug: 'compiler-notes',
        title: 'Compiler Notes - 完整原文',
        body: '# Compiler Notes\n\nFull source for deterministic build evidence.\n',
      },
      entityPages: [],
      conceptPages: [],
      synthesisPages: [],
      logEntry: 'ingested compiler-notes',
      indexEntries: ['- [[sources/compiler-notes|Compiler Notes]]'],
    })

    const result = await runCliFromArgv(['export-bundle', knowledgeRoot, '--okf', outputDir]) as {
      conceptCount: number
      indexFileCount: number
      archiveFile: string
      archiveEntryCount: number
      files: string[]
    }
    testRoots.push(result.archiveFile)
    const exported = await readFile(path.join(outputDir, 'sources', 'compiler-notes.md'), 'utf8')
    const rootIndex = await readFile(path.join(outputDir, 'index.md'), 'utf8')
    const sourcesIndex = await readFile(path.join(outputDir, 'sources', 'index.md'), 'utf8')
    const pageLog = await readFile(path.join(outputDir, 'sources', 'compiler-notes', 'log.md'), 'utf8')
    const log = await readFile(path.join(outputDir, 'log.md'), 'utf8')
    const archiveContent = gunzipSync(await readFile(result.archiveFile)).toString('utf8')

    expect(result.conceptCount).toBe(1)
    expect(result.indexFileCount).toBe(2)
    expect(result.archiveFile).toBe(`${outputDir}.tar.gz`)
    expect(result.archiveEntryCount).toBe(6)
    expect(result.files).toEqual(expect.arrayContaining([
      path.join(outputDir, '.llm-wiki-okf-export.json'),
      path.join(outputDir, 'sources', 'compiler-notes.md'),
      path.join(outputDir, 'sources', 'compiler-notes', 'log.md'),
      path.join(outputDir, 'index.md'),
      path.join(outputDir, 'sources', 'index.md'),
    ]))
    expect(exported).toContain('type: "source"\n')
    expect(exported).toContain('title: "Compiler Notes"\n')
    expect(exported).toContain('description: "Compiler Notes explains deterministic build evidence."\n')
    expect(exported).toContain('resource: "raw/compiler-notes.md"\n')
    expect(exported).toContain('tags: ["compiler"]\n')
    expect(exported).toContain('x-llmwiki-target: "sources/compiler-notes"\n')
    expect(exported).toContain('# Compiler Notes\n\nCompiler Notes explains deterministic build evidence.')
    expect(rootIndex).toContain('type: "directory-index"\n')
    expect(rootIndex).toContain('title: "OKF Bundle Index"\n')
    expect(rootIndex).toContain('description: "Directory index for the OKF bundle."\n')
    expect(rootIndex).toContain('resource: ""\n')
    expect(rootIndex).toContain('tags: ["okf-index"]\n')
    expect(rootIndex).toContain('timestamp: ')
    expect(sourcesIndex).toContain('type: "directory-index"\n')
    expect(sourcesIndex).toContain('title: "sources Index"\n')
    expect(rootIndex).toContain('* [Compiler Notes](sources/compiler-notes.md) - Compiler Notes explains deterministic build evidence.')
    expect(sourcesIndex).toContain('* [Compiler Notes](compiler-notes.md) - Compiler Notes explains deterministic build evidence.')
    expect(pageLog).toContain('"target":"sources/compiler-notes"')
    expect(log).toContain('ingested compiler-notes')
    expect(archiveContent).toContain('sources/compiler-notes.md')
    expect(archiveContent).toContain('sources/compiler-notes/log.md')
    expect(archiveContent).toContain('sources/index.md')
    expect(archiveContent).toContain('log.md')
    expect(archiveContent).toContain('.llm-wiki-okf-export.json')
  })

  it('refuses to export over unsafe or non-OKF directories', async () => {
    const knowledgeRoot = await createTestRoot()
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-okf-unsafe-'))
    testRoots.push(outputDir)
    const sentinelPath = path.join(outputDir, 'sentinel.txt')
    await writeFile(sentinelPath, 'do not delete', 'utf8')

    await expect(runCliFromArgv(['export-bundle', knowledgeRoot, '--okf', knowledgeRoot]))
      .rejects.toThrow(/overlapping the knowledge root/)
    await expect(runCliFromArgv(['export-bundle', knowledgeRoot, '--okf', outputDir]))
      .rejects.toThrow(/Refusing to delete non-OKF output directory/)
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('do not delete')
  })

  it('imports an OKF bundle as source pages and can auto-build the retrieval index', async () => {
    vi.stubEnv('llm_wiki_config', path.join(os.tmpdir(), `missing-llm-wiki-config-${Date.now()}.json`))
    const knowledgeRoot = await createTestRoot()
    const bundleDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-okf-import-'))
    testRoots.push(bundleDir)
    await mkdir(path.join(bundleDir, 'tables'), { recursive: true })
    await writeFile(path.join(bundleDir, 'index.md'), '# Bundle Index\n\n* [Orders](tables/orders.md) - completed orders.\n', 'utf8')
    await writeFile(path.join(bundleDir, 'log.md'), '# Directory Update Log\n\n## 2026-06-18\n* **Creation**: Started bundle.\n', 'utf8')
    await writeFile(path.join(bundleDir, 'tables', 'index.md'), '# Tables\n\n* [Orders](orders.md) - completed orders.\n', 'utf8')
    await writeFile(path.join(bundleDir, 'tables', 'orders.md'), [
      '---',
      'type: "BigQuery Table"',
      'title: "Orders"',
      'description: "One row per completed order."',
      'resource: "https://example.com/orders"',
      'tags:',
      '  - sales',
      '  - orders',
      'timestamp: "2026-06-18T00:00:00.000Z"',
      '---',
      '# Orders',
      '',
      'Orders stores completed sales facts.',
      '',
    ].join('\n'), 'utf8')

    const result = await runCliFromArgv(['ingest', knowledgeRoot, '--okf', bundleDir, '--auto-index']) as {
      importedCount: number
      importedPages: Array<{ pageTarget: string; okfPath: string; isDirectoryIndex: boolean }>
      index: { chunkCount: number } | null
      embedding: { status: string; reason?: string; error?: string } | null
    }

    const conceptPage = await readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'okf-tables-orders.md'), 'utf8')
    const rootIndexPage = await readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'okf-index.md'), 'utf8')
    const wikiIndex = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    const chunks = await readFile(path.join(knowledgeRoot, 'system', 'index', 'chunks.json'), 'utf8')

    expect(result.importedCount).toBe(3)
    expect(result.importedPages.map((page) => page.pageTarget).sort()).toEqual([
      'sources/okf-index',
      'sources/okf-tables-index',
      'sources/okf-tables-orders',
    ])
    expect(result.importedPages.filter((page) => page.isDirectoryIndex)).toHaveLength(2)
    expect(result.index?.chunkCount).toBeGreaterThan(0)
    expect(result.embedding).toEqual(expect.objectContaining({
      status: 'skipped',
      reason: expect.stringContaining('Embedding provider is not configured'),
    }))
    expect(conceptPage).toContain('importedFrom: "okf"\n')
    expect(conceptPage).toContain('okfVersion: "0.1"\n')
    expect(conceptPage).toContain('okfType: "BigQuery Table"\n')
    expect(conceptPage).toContain('sources: ["https://example.com/orders"]\n')
    expect(conceptPage).toContain('# Orders\n\nOrders stores completed sales facts.')
    expect(rootIndexPage).toContain('okfDirectoryIndex: true\n')
    expect(rootIndexPage).toContain('# Bundle Index')
    expect(wikiIndex).toContain('[[sources/okf-tables-orders|Orders]]')
    expect(chunks).toContain('okf-tables-orders')
  })

  it('imports OKF pages without overwriting existing source pages', async () => {
    const knowledgeRoot = await createTestRoot()
    const bundleDir = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-okf-import-collision-'))
    testRoots.push(bundleDir)
    await mkdir(path.join(bundleDir, 'tables'), { recursive: true })
    await mkdir(path.join(knowledgeRoot, 'wiki', 'sources'), { recursive: true })
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'okf-tables-orders.md'),
      '# Existing Orders\n\nThis page must not be overwritten.\n',
      'utf8',
    )
    await writeFile(path.join(bundleDir, 'tables', 'orders.md'), [
      '---',
      'type: "BigQuery Table"',
      'title: "Orders"',
      'description: "One row per completed order."',
      '---',
      '# Orders',
      '',
      'Imported orders content.',
      '',
    ].join('\n'), 'utf8')

    const result = await runCliFromArgv(['ingest', knowledgeRoot, '--okf', bundleDir]) as {
      importedPages: Array<{ pageTarget: string }>
    }

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'okf-tables-orders.md'), 'utf8'))
      .resolves.toContain('This page must not be overwritten.')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'okf-tables-orders-2.md'), 'utf8'))
      .resolves.toContain('Imported orders content.')
    expect(result.importedPages.map((page) => page.pageTarget)).toContain('sources/okf-tables-orders-2')
  })

  it('maintains OKF directory indexes without adding them to the retrieval catalog', async () => {
    const knowledgeRoot = await createTestRoot()

    await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: {
        slug: 'compiler-notes',
        title: 'Compiler Notes',
        body: '# Compiler Notes\n\nCompiler Notes explains deterministic build evidence.\n',
      },
      readingPage: {
        slug: 'compiler-notes',
        title: 'Compiler Notes - 完整原文',
        body: '# Compiler Notes\n\nFull source for deterministic build evidence.\n',
      },
      entityPages: [{ slug: 'openclaw', title: 'OpenClaw', body: '# OpenClaw\n\nOpenClaw runs local agent workflows.\n' }],
      conceptPages: [],
      synthesisPages: [],
      logEntry: 'ingested compiler-notes',
      indexEntries: [
        '- [[sources/compiler-notes|Compiler Notes]]',
        '- [[entities/openclaw|OpenClaw]]',
      ],
    })

    const result = await runCliFromArgv(['maintain', knowledgeRoot]) as {
      okfDirectoryIndexes: {
        generatedCount: number
        indexedPageCount: number
        files: Array<{ directory: string; entryCount: number }>
      }
      index: { pageCount: number; chunkCount: number }
    }

    const sourceIndex = await readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'index.md'), 'utf8')
    const entityIndex = await readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'index.md'), 'utf8')
    const rootIndex = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    const pages = await readFile(path.join(knowledgeRoot, 'system', 'index', 'pages.json'), 'utf8')

    expect(result.okfDirectoryIndexes.generatedCount).toBe(2)
    expect(result.okfDirectoryIndexes.indexedPageCount).toBe(2)
    expect(result.okfDirectoryIndexes.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ directory: 'sources', entryCount: 1 }),
      expect.objectContaining({ directory: 'entities', entryCount: 1 }),
    ]))
    expect(result.index.pageCount).toBe(2)
    expect(result.index.chunkCount).toBeGreaterThan(0)
    expect(sourceIndex).toContain('type: "directory-index"\n')
    expect(sourceIndex).toContain('title: "Sources Index"\n')
    expect(sourceIndex).toContain('description: "Directory index for sources."\n')
    expect(sourceIndex).toContain('resource: ""\n')
    expect(sourceIndex).toContain('tags: ["okf-index"]\n')
    expect(sourceIndex).toContain('timestamp: ')
    expect(sourceIndex).toContain('* [Compiler Notes](compiler-notes.md) - Compiler Notes explains deterministic build evidence.')
    expect(entityIndex).toContain('type: "directory-index"\n')
    expect(entityIndex).toContain('* [OpenClaw](openclaw.md) - OpenClaw runs local agent workflows.')
    expect(rootIndex).not.toContain('[[sources/index')
    expect(rootIndex).not.toContain('[[entities/index')
    expect(pages).not.toContain('"target": "sources/index"')
    expect(pages).not.toContain('"target": "entities/index"')
  })

  it('maintain backfills historical source-card-only entries into complete wiki assets', async () => {
    const knowledgeRoot = await createTestRoot()
    const sourcePath = path.join(knowledgeRoot, 'compiler-notes.md')
    await writeFile(
      sourcePath,
      '# Compiler Notes\n\nEntity: OpenClaw\nConcept: compilation\n\nOpenClaw keeps compilation deterministic.\n',
      'utf8',
    )

    await runCliIngestWithCuration(knowledgeRoot, sourcePath)

    const dedupPath = path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json')
    const dedupManifest = JSON.parse(await readFile(dedupPath, 'utf8')) as {
      entries: Record<string, {
        lastOutputManifest: {
          pageFiles: string[]
          indexEntries: string[]
          pageSnapshots?: Array<{ filePath: string }>
        }
      }>
    }
    const entry = dedupManifest.entries[path.resolve(sourcePath)]
    if (!entry) {
      throw new Error('expected dedup manifest entry')
    }
    entry.lastOutputManifest.pageFiles = ['wiki/sources/compiler-notes.md']
    entry.lastOutputManifest.indexEntries = ['- [[sources/compiler-notes|Compiler Notes]]']
    delete entry.lastOutputManifest.pageSnapshots
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'),
      '# Compiler Notes\n\nManual source card note must stay.\n',
      'utf8',
    )
    await writeFile(dedupPath, `${JSON.stringify(dedupManifest, null, 2)}\n`, 'utf8')
    await rm(path.join(knowledgeRoot, 'wiki', 'readings', 'compiler-notes.md'), { force: true })
    await rm(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), { force: true })
    await rm(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), { force: true })

    const result = await runCliFromArgv(['maintain', knowledgeRoot]) as {
      wikiAssets: {
        backfilledEntries: number
        status: string
        warnings: string[]
      }
    }

    expect(result.wikiAssets).toMatchObject({
      status: 'ready',
      backfilledEntries: 1,
      warnings: [],
    })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'readings', 'compiler-notes.md'), 'utf8'))
      .resolves.toContain('## 原文全文')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8'))
      .resolves.toContain('Manual source card note must stay.')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8'))
      .resolves.toContain('[[readings/compiler-notes|完整原文]]')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })

    const refreshedManifest = JSON.parse(await readFile(dedupPath, 'utf8')) as {
      entries: Record<string, { lastOutputManifest: { pageFiles: string[]; pageSnapshots?: Array<{ filePath: string }> } }>
    }
    expect(refreshedManifest.entries[path.resolve(sourcePath)]?.lastOutputManifest.pageFiles).toEqual(expect.arrayContaining([
      'wiki/sources/compiler-notes.md',
      'wiki/readings/compiler-notes.md',
    ]))
    expect(refreshedManifest.entries[path.resolve(sourcePath)]?.lastOutputManifest.pageSnapshots?.map((snapshot) => snapshot.filePath))
      .toEqual(expect.arrayContaining([
        'wiki/sources/compiler-notes.md',
        'wiki/readings/compiler-notes.md',
      ]))
  })

  it('rejects unsafe slugs before writing outside the wiki section', async () => {
    const knowledgeRoot = await createTestRoot()

    await expect(
      writeKnowledgeChanges({
        knowledgeRoot,
        sourcePage: { slug: '../../../escape-target/bad', title: 'Bad', body: '...' },
        readingPage: { slug: 'bad', title: 'Bad - 完整原文', body: '...' },
        entityPages: [],
        conceptPages: [],
        synthesisPages: [],
        logEntry: 'should not write',
        indexEntries: ['[[bad]]'],
      }),
    ).rejects.toThrow(/invalid slug/i)

    await expect(readFile(path.join(knowledgeRoot, 'escape-target', 'bad.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('escapes log messages so tabs and newlines remain parseable', async () => {
    const knowledgeRoot = await createTestRoot()
    const message = 'line one\twith tab\nand newline'

    await appendWikiLog(knowledgeRoot, message)

    const logLines = readLogDataLines(await readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8'))
    expect(logLines).toHaveLength(1)
    expect(parseLogLineMessage(logLines[0])).toBe(message)
  })
})

function readLogDataLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '# Wiki Log' && line !== '# Wiki 日志')
}

function parseLogLineMessage(line: string): string {
  const separatorIndex = line.indexOf('\t')
  expect(separatorIndex).toBeGreaterThan(0)
  return JSON.parse(line.slice(separatorIndex + 1)) as string
}

async function createTestRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-write-test-'))
  testRoots.push(root)
  return root
}
