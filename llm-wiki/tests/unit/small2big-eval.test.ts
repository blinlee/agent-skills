import { describe, expect, it } from 'vitest'
import { buildTextWindows, lineRangeForWindow } from '../../src/retrieval/chunking.js'
import { buildSmall2BigCandidates, evaluateSmall2BigChunking, splitSentenceSpans } from '../../src/retrieval/small2big-eval.js'

describe('Small2Big chunking evaluation', () => {
  it('splits sentence retrieval units while preserving source offsets and line ranges', () => {
    const text = [
      '# GraphRAG Notes',
      'GraphRAG links entity relations to retrieval claims.',
      '多跳证据应该保留前后文。',
      '',
      'A short paragraph without terminal punctuation',
    ].join('\n')

    const spans = splitSentenceSpans(text)

    expect(spans.map((span) => span.text)).toEqual([
      '# GraphRAG Notes\nGraphRAG links entity relations to retrieval claims.',
      '多跳证据应该保留前后文。',
      'A short paragraph without terminal punctuation',
    ])
    expect(text.slice(spans[1]!.startOffset, spans[1]!.endOffset)).toBe('多跳证据应该保留前后文。')

    const candidates = buildSmall2BigCandidates({ id: 'rag-kg', title: 'RAG KG', text }, 1)
    expect(candidates[1]).toEqual(expect.objectContaining({
      retrievalText: '多跳证据应该保留前后文。',
      retrievalLineRange: { startLine: 3, endLine: 3 },
      contextLineRange: { startLine: 1, endLine: 5 },
    }))
    expect(candidates[1]!.contextText).toContain('GraphRAG links entity relations')
    expect(candidates[1]!.contextText).toContain('A short paragraph')
  })

  it('compares fixed chunks with sentence retrieval plus expanded context', () => {
    const filler = 'Background governance notes repeat routing policy language. '.repeat(8)
    const text = [
      '# RAG Knowledge Graph',
      filler,
      'GraphRAG stores entity relation edges for retrieval.',
      'Multi-hop evidence expansion connects adjacent claims.',
      filler,
    ].join('\n')

    const result = evaluateSmall2BigChunking({
      documents: [{ id: 'rag-knowledge-graph', title: 'RAG Knowledge Graph', text }],
      queries: [{
        id: 'entity-relations',
        question: 'How does GraphRAG use entity relation evidence expansion?',
        expectedTerms: ['entity relation edges', 'multi-hop evidence expansion'],
        k: 1,
      }],
      contextSentences: 1,
    })

    expect(result.candidateCounts.fixed).toBeGreaterThan(0)
    expect(result.candidateCounts.small2big).toBeGreaterThan(result.candidateCounts.fixed)
    expect(result.queries[0]!.fixed.recallAtK).toBe(1)
    expect(result.queries[0]!.small2big.recallAtK).toBe(1)
    expect(result.queries[0]!.small2big.readChars).toBeLessThan(result.queries[0]!.fixed.readChars)
    expect(result.queries[0]!.small2big.citationImpact.widenedCitations).toBe(1)
    expect(result.queries[0]!.small2big.citationImpact.averageContextExpansionChars).toBeGreaterThan(0)
    expect(result.config.corpusKind).toBe('fixture')
    expect(result.summary.recommendation).toBe('needs-real-corpus-evaluation')
    expect(result.summary.rationale).toContain('Implementation recommendation requires a real knowledge-root corpus, not a fixture.')
  })

  it('keeps fixed-window behavior reusable for production index building', () => {
    const text = '  first line\nsecond line\nthird line  '
    const windows = buildTextWindows(text, 12, 2)

    expect(windows[0]).toEqual({
      text: 'first line',
      startOffset: 2,
      endOffset: 12,
    })
    expect(lineRangeForWindow(text, 10, windows[1]!.startOffset, windows[1]!.endOffset)).toEqual({
      startLine: 10,
      endLine: 11,
    })
  })
})
