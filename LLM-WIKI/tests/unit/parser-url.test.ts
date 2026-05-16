import { describe, expect, it, vi } from 'vitest'
import { parseUrlSource } from '../../src/parsers/url'

describe('url parser', () => {
  it('builds a normalized artifact from cleaned web content', async () => {
    const fetchCleanedContent = vi.fn(async (url: string) => ({
      title: 'Example Post',
      body: 'Clean body text',
    }))

    const artifact = await parseUrlSource(
      {
        sourceId: 'u1',
        url: 'https://example.com/post',
        parsedAt: '2026-04-19T18:00:00.000Z',
      },
      fetchCleanedContent,
    )

    expect(fetchCleanedContent).toHaveBeenCalledWith('https://example.com/post')
    expect(artifact.sourceKind).toBe('url')
    expect(artifact.title).toBe('Example Post')
    expect(artifact.content).toContain('Clean body text')
    expect(artifact.sourceRef).toBe('https://example.com/post')
    expect(artifact.metadata.sourceId).toBe('u1')
    expect(artifact.metadata.path).toBe('https://example.com/post')
    expect(artifact.metadata.url).toBe('https://example.com/post')
    expect(artifact.metadata.parser).toBe('url')
    expect(artifact.createdAt).toBe('2026-04-19T18:00:00.000Z')
    expect(artifact.updatedAt).toBe('2026-04-19T18:00:00.000Z')
  })
})
