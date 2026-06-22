import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRetrievalConfidenceThresholdFromEnv, scoreRetrievalConfidence } from '../../src/retrieval/confidence.js'
import type { RetrievalHit } from '../../src/retrieval/types.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('retrieval confidence threshold', () => {
  it('loads the default threshold and validates environment overrides', () => {
    expect(loadRetrievalConfidenceThresholdFromEnv({} as NodeJS.ProcessEnv)).toBe(0.35)
    expect(loadRetrievalConfidenceThresholdFromEnv({ LLM_WIKI_CONFIDENCE_THRESHOLD: '0.6' } as NodeJS.ProcessEnv)).toBe(0.6)
    expect(() => loadRetrievalConfidenceThresholdFromEnv({ LLM_WIKI_CONFIDENCE_THRESHOLD: '1.5' } as NodeJS.ProcessEnv))
      .toThrow(/Invalid LLM_WIKI_CONFIDENCE_THRESHOLD: 1\.5/)
  })

  it('uses the configured threshold when deciding low confidence', () => {
    const hit = retrievalHit()

    expect(scoreRetrievalConfidence('matched', [hit]).lowConfidence).toBe(false)

    vi.stubEnv('LLM_WIKI_CONFIDENCE_THRESHOLD', '0.8')
    expect(scoreRetrievalConfidence('matched', [hit]).lowConfidence).toBe(true)
  })
})

function retrievalHit(): RetrievalHit {
  return {
    chunk: {
      version: 2,
      id: 'chunk-confidence',
      chunkId: 'chunk-confidence',
      pageTarget: 'sources/confidence',
      pageTitle: 'Confidence',
      filePath: '/tmp/confidence.md',
      sourceRef: '/tmp/source.md',
      rawPath: '/tmp/source.md',
      evidenceKind: 'raw',
      heading: 'Confidence',
      headingPath: ['Confidence'],
      level: 1,
      startLine: 1,
      endLine: 3,
      anchor: 'confidence',
      text: 'Confidence evidence supports the answer.',
      textSha256: 'confidence-hash',
      tokenCountApprox: 5,
      links: [],
      metadata: {
        docType: 'source',
        section: 'sources',
        slug: 'confidence',
      },
    },
    score: {
      lexical: 0.5,
      embedding: 0,
      graph: 0,
      taxonomy: 0,
      metadata: 0,
      rerank: 0,
      total: 0.5,
    },
    reasons: ['coverage:lexical-coverage'],
    citation: {
      pageTarget: 'sources/confidence',
      pageTitle: 'Confidence',
      filePath: '/tmp/confidence.md',
      heading: 'Confidence',
      headingPath: ['Confidence'],
      startLine: 1,
      endLine: 3,
      sourceRef: '/tmp/source.md',
      rawPath: '/tmp/source.md',
      evidenceKind: 'raw',
      excerpt: 'Confidence evidence supports the answer.',
    },
  }
}
