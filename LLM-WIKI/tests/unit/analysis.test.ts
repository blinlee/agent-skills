import { describe, expect, it } from 'vitest'
import { analyzeArtifact } from '../../src/compile/analysis'
import type { NormalizedArtifact } from '../../src/types'

describe('artifact analysis knowledge-organization policy', () => {
  it('derives taxonomy candidates from controlled title phrases instead of generic body words', async () => {
    const analysis = await analyzeArtifact(artifact({
      title: 'Effective harnesses for long-running agents',
      content: [
        '# Effective harnesses for long-running agents',
        '',
        'Existing approaches include choosing anything convenient when configuring and debugging agent environments.',
        'Long-running agents need harness design, feedback loops, and durable execution context.',
      ].join('\n'),
    }))

    const topicSlugs = analysis.topics.map((topic) => topic.slug)

    expect(topicSlugs).toEqual(expect.arrayContaining([
      'long-running-agents',
    ]))
    expect(topicSlugs).not.toEqual(expect.arrayContaining([
      'anything',
      'choosing',
      'configuring',
      'debugging',
      'existing',
      'including',
    ]))
    expect(analysis.topics.every((topic) => topic.confidence >= 0.64)).toBe(true)
  })

  it('keeps source-map/index artifacts reviewable without hardening navigation labels as taxonomy', async () => {
    const analysis = await analyzeArtifact({
      id: 'index-map',
      sourceKind: 'md',
      sourceRef: '/tmp/INDEX.md',
      title: 'INDEX',
      content: 'Compiler Notes\nSlash Commands\nHarness Design',
      summary: 'Index source.',
      tags: [],
      metadata: {
        sourceRole: 'source-map',
      },
      createdAt: '2026-05-14T00:00:00.000Z',
      updatedAt: '2026-05-14T00:00:00.000Z',
    })

    expect(analysis.candidateEntities).toEqual([])
    expect(analysis.candidateConcepts).toEqual([])
    expect(analysis.topics).toEqual([])
    expect(analysis.reviewTriggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'sparse-artifact',
        reason: expect.stringMatching(/source-map/i),
      }),
    ]))
  })
})

function artifact(overrides: Pick<NormalizedArtifact, 'title' | 'content'>): NormalizedArtifact {
  const now = new Date().toISOString()
  return {
    id: 'artifact-1',
    sourceKind: 'md',
    sourceRef: 'memory.md',
    title: overrides.title,
    content: overrides.content,
    summary: '',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  }
}
