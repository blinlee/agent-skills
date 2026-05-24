import { access, appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runIngestCommand, runInitCommand, runLintCommand, runQueryCommand, runStatusCommand } from '../../src/cli'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})
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

describe('query, lint, and status', () => {
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
    expect(schema).toContain('# Wiki Schema')
    expect(schema).toContain('LLM-WIKI compiles normalized raw material')
    expect(schema).toContain('[[sources/source-slug|Title]]')
    expect(schema).toContain('Human-in-the-loop classification')
    expect(schema).toContain('High model confidence is not approval')
    expect(index).toBe('# Wiki Index\n')
    expect(log).toBe('# Wiki Log\n')
  })

  it('answers from wiki/index.md and reports healthy status', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    await qualifySampleCompilerNotesLinks(knowledgeRoot)

    const status = await runStatusCommand({ knowledgeRoot })
    const lint = await runLintCommand({ knowledgeRoot })
    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is Compiler Notes?',
    })

    expect(status.knowledgeRootExists).toBe(true)
    expect(status.requiredDirectories.missing).toEqual([])
    expect(status.requiredFiles.missing).toEqual([])
    expect(lint.status).toBe('ok')
    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.answer).toMatch(/Compiler Notes/i)
    expect(answer.synthesisSuggestion).toBeTruthy()
    await expect(access(answer.synthesisSuggestion!.filePath)).resolves.toBeUndefined()
  })

  it('returns an explicit no-match response instead of fabricating an answer from the first source page', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is flibbertigibbet quantum umbrella?',
    })

    expect(answer.answer).toMatch(/could not find enough matching evidence/i)
    expect(answer.citations).toEqual([])
    expect(answer.synthesisSuggestion).toBeNull()
  })

  it('can select a relevant page by indexed page content rather than title alone', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is deterministic across the knowledge pipeline?',
    })

    expect(answer.citations.length).toBeGreaterThan(0)
    expect(answer.answer).toMatch(/deterministic|knowledge pipeline|Compiler Notes/i)
    expect(answer.citations.map((citation) => citation.target)).toEqual(
      expect.arrayContaining(['sources/compiler-notes']),
    )
  })

  it('does not let one stale index entry break queries for readable pages', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const indexPath = path.join(knowledgeRoot, 'wiki', 'index.md')
    await appendFile(indexPath, '- [[entities/missing-stale-page|Missing Stale Page]]\n', 'utf8')

    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is Compiler Notes?',
    })
    const lint = await runLintCommand({ knowledgeRoot })

    expect(answer.citations.map((citation) => citation.target)).toContain('sources/compiler-notes')
    expect(answer.citations.map((citation) => citation.target)).not.toContain('entities/missing-stale-page')
    expect(lint.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-linked-page',
        path: path.join(knowledgeRoot, 'wiki', 'entities', 'missing-stale-page.md'),
      }),
    ]))
  })

  it('reports missing linked pages referenced directly from wiki/index.md', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const indexPath = path.join(knowledgeRoot, 'wiki', 'index.md')
    const indexContent = await readFile(indexPath, 'utf8')
    await writeFile(indexPath, `${indexContent.trimEnd()}\n- [[entities/ghost|Ghost]]\n`, 'utf8')

    const lint = await runLintCommand({ knowledgeRoot })

    expect(lint.status).toBe('error')
    expect(lint.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-linked-page',
        path: path.join(knowledgeRoot, 'wiki', 'entities', 'ghost.md'),
      }),
    ]))
  })

  it('treats ambiguous bare-slug links as unresolved instead of picking the first matching page', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    const indexPath = path.join(knowledgeRoot, 'wiki', 'index.md')
    await appendFile(indexPath, '- [[entities/openclaw|OpenClaw Entity]]\n- [[concepts/openclaw|OpenClaw Concept]]\n- [[sources/disambiguation-ledger|Disambiguation Ledger]]\n', 'utf8')

    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'entities', 'openclaw.md'),
      '# OpenClaw Entity\n\n## Summary\nThis entity page shares the same slug as the concept page.\n',
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'concepts', 'openclaw.md'),
      '# OpenClaw Concept\n\n## Summary\nThis concept page shares the same slug as the entity page.\n',
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'sources', 'disambiguation-ledger.md'),
      '# Disambiguation Ledger\n\n## Summary\nThis page references [[openclaw|OpenClaw]] using a bare slug link.\n',
      'utf8',
    )

    const lint = await runLintCommand({ knowledgeRoot })
    const answer = await runQueryCommand({
      knowledgeRoot,
      question: 'What is Disambiguation Ledger?',
    })

    expect(lint.status).toBe('error')
    expect(lint.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ambiguous-linked-page',
        path: path.join(knowledgeRoot, 'wiki', 'sources', 'disambiguation-ledger.md'),
      }),
    ]))
    expect(answer.citations.map((citation) => citation.target)).toContain('sources/disambiguation-ledger')
    expect(answer.citations.map((citation) => citation.target)).not.toContain('entities/openclaw')
    expect(answer.citations.map((citation) => citation.target)).not.toContain('concepts/openclaw')
  })

  it('warns on stray markdown pages on disk that are not linked', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runIngestCommand({
      knowledgeRoot,
      input: path.join(process.cwd(), 'tests', 'fixtures', 'inputs', 'sample.md'),
    })

    await qualifySampleCompilerNotesLinks(knowledgeRoot)

    const orphanPath = path.join(knowledgeRoot, 'wiki', 'entities', 'orphan-page.md')
    await writeFile(orphanPath, '# Orphan Page\n\n## Summary\nThis page is not indexed.\n', 'utf8')

    const lint = await runLintCommand({ knowledgeRoot })

    expect(lint.status).toBe('warn')
    expect(lint.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'orphan-page',
        path: orphanPath,
      }),
    ]))
  })

  it('allows source and concept namespaces to share a title without duplicate-title noise', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runInitCommand({ knowledgeRoot })
    const sourcePage = path.join(knowledgeRoot, 'wiki', 'sources', 'slash-commands.md')
    const conceptPage = path.join(knowledgeRoot, 'wiki', 'concepts', 'slash-commands.md')
    const frontmatter = (type: string) => [
      '---',
      'title: "Slash Commands"',
      'created: "2026-05-14T00:00:00.000Z"',
      'updated: "2026-05-14T00:00:00.000Z"',
      `type: "${type}"`,
      'tags: ["slash-commands"]',
      'sources: ["fixture"]',
      'confidence: "medium"',
      'contested: false',
      '---',
      '# Slash Commands',
      '',
      `[[${type === 'source' ? 'concepts' : 'sources'}/slash-commands|Slash Commands]]`,
      '',
    ].join('\n')
    await writeFile(sourcePage, frontmatter('source'), 'utf8')
    await writeFile(conceptPage, frontmatter('concept'), 'utf8')
    await writeFile(
      path.join(knowledgeRoot, 'wiki', 'index.md'),
      '# Wiki Index\n\n## Sources\n- [[sources/slash-commands|Slash Commands]]\n\n## Concepts\n- [[concepts/slash-commands|Slash Commands]]\n',
      'utf8',
    )

    const lint = await runLintCommand({ knowledgeRoot })

    expect(lint.status).toBe('ok')
    expect(lint.warnings.map((warning) => warning.code)).not.toContain('duplicate-page-title')
  })

  it('detects taxonomy hierarchy cycles and redirect loops', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-e2e-'))
    tempRoots.push(knowledgeRoot)

    await runInitCommand({ knowledgeRoot })
    await writeFile(
      path.join(knowledgeRoot, 'taxonomy', 'category-graph.json'),
      JSON.stringify({
        nodes: [],
        edges: [
          { from: 'llm', to: 'ai', type: 'is-a', status: 'accepted' },
          { from: 'ai', to: 'llm', type: 'is-a', status: 'accepted' },
        ],
      }, null, 2),
      'utf8',
    )
    await writeFile(
      path.join(knowledgeRoot, 'taxonomy', 'redirects.json'),
      JSON.stringify({ redirects: { rag: 'retrieval-augmented-generation', 'retrieval-augmented-generation': 'rag' } }, null, 2),
      'utf8',
    )

    const lint = await runLintCommand({ knowledgeRoot })

    expect(lint.status).toBe('error')
    expect(lint.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'taxonomy-cycle' }),
      expect.objectContaining({ code: 'taxonomy-redirect-cycle' }),
    ]))
  })

})
