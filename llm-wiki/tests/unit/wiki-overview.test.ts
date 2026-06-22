import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runWikiOverview, type WikiOverviewGenerator } from '../../src/retrieval/wiki-overview.js'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('wiki overview generation', () => {
  it('writes an LLM synthesized overview with durable metadata and deterministic index fallback', async () => {
    const knowledgeRoot = await mkdtemp(path.join(os.tmpdir(), 'llm-wiki-overview-'))
    tempRoots.push(knowledgeRoot)
    const indexRoot = path.join(knowledgeRoot, 'system', 'index')
    await mkdir(indexRoot, { recursive: true })
    await writeFile(path.join(indexRoot, 'pages.json'), JSON.stringify({
      pages: [{
        target: 'sources/compiler-notes',
        title: 'Compiler Notes',
        section: 'sources',
        slug: 'compiler-notes',
        filePath: path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'),
        sha256: 'sha',
        lineCount: 5,
        headings: ['Summary', 'Boundaries'],
        outgoingLinks: [],
      }],
    }), 'utf8')
    await writeFile(path.join(indexRoot, 'chunks.json'), JSON.stringify({
      version: 2,
      schema: 'llm-wiki.chunks.v2',
      knowledgeRoot,
      generatedAt: '2026-06-20T00:00:00.000Z',
      chunks: [{
        version: 2,
        id: 'sources/compiler-notes#1',
        chunkId: 'chunk-1',
        pageTarget: 'sources/compiler-notes',
        pageTitle: 'Compiler Notes',
        filePath: path.join(knowledgeRoot, 'wiki', 'sources', 'compiler-notes.md'),
        sourceRef: '/tmp/compiler-notes.md',
        heading: 'Summary',
        headingPath: ['Summary'],
        level: 2,
        startLine: 1,
        endLine: 5,
        anchor: 'summary',
        text: 'Compiler Notes explains deterministic compilation and evidence-first retrieval boundaries.',
        textSha256: 'text-sha',
        tokenCountApprox: 12,
        links: [],
        metadata: { docType: 'source', section: 'sources', slug: 'compiler-notes' },
      }],
    }), 'utf8')
    const generator: WikiOverviewGenerator = {
      async generate(input) {
        expect(input.sourceText).toContain('Compiler Notes')
        return '## 主题范围\n\n这个 wiki 关注 deterministic compilation。\n\n## 主要分类\n\n- sources'
      },
    }

    const result = await runWikiOverview({
      knowledgeRoot,
      config: {
        endpoint: 'http://127.0.0.1:9999/overview',
        model: 'local-overview',
        timeoutMs: 1000,
        maxInputChars: 10_000,
        language: '中文',
        promptTemplate: '{title}\n{sourceText}\n{language}',
      },
      generator,
    })
    const content = await readFile(result.filePath, 'utf8')

    expect(result).toMatchObject({ generation: 'llm', model: 'local-overview', pageCount: 1, chunkCount: 1 })
    expect(content).toContain('generation: "llm"')
    expect(content).toContain('model: "local-overview"')
    expect(content).toContain('## 主题范围')
    expect(content).toContain('这个 wiki 关注 deterministic compilation')
    expect(content).toContain('## Deterministic Index')
    expect(content).toContain('[[sources/compiler-notes|Compiler Notes]]')
  })
})
