import { describe, expect, it } from 'vitest'
import { parseMarkdownSource } from '../../src/parsers/markdown.js'
import { parseTextSource } from '../../src/parsers/text.js'

describe('text-like parsers', () => {
  it('parses markdown into a normalized artifact', async () => {
    const artifact = await parseMarkdownSource({
      sourceId: 's1',
      path: '/tmp/test.md',
      content: '# Title\n\nHello',
      parsedAt: '2026-04-19T18:00:00.000Z',
    })

    expect(artifact.sourceKind).toBe('md')
    expect(artifact.title).toBe('Title')
    expect(artifact.content).toContain('Hello')
    expect(artifact.sourceRef).toBe('/tmp/test.md')
    expect(artifact.metadata.sourceId).toBe('s1')
    expect(artifact.metadata.path).toBe('/tmp/test.md')
    expect(artifact.createdAt).toBe('2026-04-19T18:00:00.000Z')
    expect(artifact.updatedAt).toBe('2026-04-19T18:00:00.000Z')
  })

  it('parses txt into a normalized artifact', async () => {
    const artifact = await parseTextSource({
      sourceId: 's2',
      path: '/tmp/test.txt',
      content: 'plain text',
    })

    expect(artifact.sourceKind).toBe('txt')
    expect(artifact.title).toBe('plain text')
    expect(artifact.content).toContain('plain text')
    expect(artifact.metadata.sourceId).toBe('s2')
  })

  it('falls back when markdown has no heading and normalizes newlines', async () => {
    const artifact = await parseMarkdownSource({
      sourceId: 's3',
      path: '/tmp/fallback.md',
      content: '\r\nIntro line\r\n\r\n- item one\r\n',
    })

    expect(artifact.title).toBe('Intro line')
    expect(artifact.content).toBe('Intro line\n\nitem one')
  })

  it('strips markdown frontmatter from body while preserving audit metadata', async () => {
    const artifact = await parseMarkdownSource({
      sourceId: 's4',
      path: '/tmp/slash-commands.md',
      content: '---\ntitle: "Slash Commands"\nsummary: "Command notes"\n---\n\nSlash commands\n\nUseful details.',
      parsedAt: '2026-04-19T18:00:00.000Z',
    })

    expect(artifact.title).toBe('Slash Commands')
    expect(artifact.content).toBe('Slash commands\n\nUseful details.')
    expect(artifact.content).not.toContain('summary:')
    expect(artifact.metadata.hasFrontmatter).toBe(true)
    expect(artifact.metadata.frontmatterTitle).toBe('Slash Commands')
  })

  it('marks markdown index files as source maps instead of ordinary evidence', async () => {
    const artifact = await parseMarkdownSource({
      sourceId: 's5',
      path: '/tmp/INDEX.md',
      content: '# INDEX\n\n- [Compiler Notes](compiler-notes.md)\n- [[Slash Commands]]\n',
    })

    expect(artifact.metadata.sourceRole).toBe('source-map')
  })
})
