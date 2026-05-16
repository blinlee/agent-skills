import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runBuildIndexCommand, runCliFromArgv, runIngestCommand } from '../../src/cli'

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

    const result = await runBuildIndexCommand({ knowledgeRoot })
    const pages = JSON.parse(await readFile(result.files.pages, 'utf8')) as { pages: Array<{ target: string; headings: string[]; outgoingLinks: string[] }> }
    const chunks = JSON.parse(await readFile(result.files.chunks, 'utf8')) as { chunks: Array<{ pageTarget: string; heading: string; text: string }> }
    const links = JSON.parse(await readFile(result.files.links, 'utf8')) as { links: Array<{ from: string; to: string | null; status: string }>; backlinks: Record<string, string[]> }

    expect(result.pageCount).toBeGreaterThan(0)
    expect(result.chunkCount).toBeGreaterThan(0)
    expect(pages.pages.map((page) => page.target)).toContain('sources/compiler-notes')
    expect(chunks.chunks.some((chunk) => chunk.pageTarget === 'sources/compiler-notes' && /Compiler Notes/.test(chunk.text))).toBe(true)
    expect(links.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'entities/openclaw', to: 'sources/compiler-notes', status: 'resolved' }),
    ]))
    expect(links.backlinks['sources/compiler-notes']).toContain('entities/openclaw')
  })

  it('exposes index through the JSON CLI argv surface', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-index-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const result = await runCliFromArgv(['index', knowledgeRoot])
    expect(result).toMatchObject({ knowledgeRoot, pageCount: expect.any(Number), chunkCount: expect.any(Number) })
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

async function rewriteIfPresent(filePath: string, rewrite: (content: string) => string): Promise<void> {
  const content = await readFile(filePath, 'utf8')
  await writeFile(filePath, rewrite(content), 'utf8')
}
