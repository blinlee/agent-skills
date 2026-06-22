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

describe('lint and status structural checks', () => {
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

    await runBuildIndexCommand({ knowledgeRoot })

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
