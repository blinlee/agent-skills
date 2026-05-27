import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendWikiLog, updateWikiIndex } from '../../src/wiki/index-log.js'
import { writeKnowledgeChanges } from '../../src/wiki/page-writer.js'

const testRoots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(testRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('wiki writes', () => {
  it('writes source/entity/concept pages and updates index/log', async () => {
    const knowledgeRoot = await createTestRoot()

    const result = await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '...' },
      entityPages: [{ slug: 'openclaw', title: 'OpenClaw', body: '...' }],
      conceptPages: [{ slug: 'compilation', title: 'Compilation', body: '...' }],
      synthesisSuggestions: [],
      logEntry: 'ingested compiler-notes',
      indexEntries: ['[[compiler-notes]]'],
    })

    expect(result.writtenFiles).toEqual(
      expect.arrayContaining([
        expect.stringContaining('wiki/sources/compiler-notes.md'),
        expect.stringContaining('wiki/entities/openclaw.md'),
        expect.stringContaining('wiki/concepts/compilation.md'),
      ]),
    )

    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8')).resolves.toContain('type: "source"\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'), 'utf8')).resolves.toContain('# Compiler Notes\n\n...\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8')).resolves.toContain('type: "entity"\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'), 'utf8')).resolves.toContain('# OpenClaw\n\n...\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), 'utf8')).resolves.toContain('type: "concept"\n')
    await expect(readFile(path.join(knowledgeRoot, 'wiki', 'concepts', 'compilation.md'), 'utf8')).resolves.toContain('# Compilation\n\n...\n')

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')
    expect(indexContent).toContain('# Wiki Index')
    expect(indexContent).toContain('## Other')
    expect(indexContent).toContain('[[compiler-notes]]')

    const logContent = await readFile(path.join(knowledgeRoot, 'wiki', 'log.md'), 'utf8')
    expect(logContent).toContain('# Wiki Log')

    const logLines = readLogDataLines(logContent)
    expect(logLines).toHaveLength(1)
    expect(parseLogLineMessage(logLines[0])).toBe('ingested compiler-notes')
  })

  it('groups qualified wiki index entries by page type for Obsidian-style navigation', async () => {
    const knowledgeRoot = await createTestRoot()

    await updateWikiIndex(knowledgeRoot, [
      '- [[concepts/compilation|Compilation]]',
      '- [[sources/compiler-notes|Compiler Notes]]',
      '- [[entities/openclaw|OpenClaw]]',
    ])

    const indexContent = await readFile(path.join(knowledgeRoot, 'wiki', 'index.md'), 'utf8')

    expect(indexContent).toMatch(/# Wiki Index\n\n## Sources\n- \[\[sources\/compiler-notes\|Compiler Notes\]\]\n\n## Entities\n- \[\[entities\/openclaw\|OpenClaw\]\]\n\n## Concepts\n- \[\[concepts\/compilation\|Compilation\]\]/)
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
    expect(indexContent).toContain('## Sources')
    expect(logLines).toHaveLength(1)
    expect(parseLogLineMessage(logLines[0])).toBe('ingested compiler-notes')
  })

  it('does not duplicate identical index entries across repeated writes', async () => {
    const knowledgeRoot = await createTestRoot()

    await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '# Compiler Notes\n\nFirst pass.' },
      entityPages: [],
      conceptPages: [],
      synthesisSuggestions: [],
      logEntry: 'ingested compiler-notes',
      indexEntries: ['[[compiler-notes]]'],
    })

    await writeKnowledgeChanges({
      knowledgeRoot,
      sourcePage: { slug: 'compiler-notes', title: 'Compiler Notes', body: '# Compiler Notes\n\nSecond pass.' },
      entityPages: [],
      conceptPages: [],
      synthesisSuggestions: [],
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

  it('rejects unsafe slugs before writing outside the wiki section', async () => {
    const knowledgeRoot = await createTestRoot()

    await expect(
      writeKnowledgeChanges({
        knowledgeRoot,
        sourcePage: { slug: '../../../escape-target/bad', title: 'Bad', body: '...' },
        entityPages: [],
        conceptPages: [],
        synthesisSuggestions: [],
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
    .filter((line) => line.length > 0 && line !== '# Wiki Log')
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
