import { describe, expect, it } from 'vitest'
import { buildQueryIntent, isEvidenceDomainConsistent, isStrongSemanticEvidence, scoreEvidenceIntentFit } from '../../src/query/intent.js'
import { displaySourceTitle } from '../../src/query/source-title.js'

describe('query intent and final evidence fit', () => {
  it('keeps technical architecture questions passage-first unless they ask for a survey', () => {
    expect(buildQueryIntent('LightRAG 的 query mode 架构是怎么工作的？').answerShape).toBe('technical')
    expect(buildQueryIntent('LightRAG 的 query mode 架构是怎么工作的？').prefersDocumentReading).toBe(false)

    const survey = buildQueryIntent('基于AI的量化研究现在主要框架是怎样的，哪几种路线？')
    expect(survey.answerShape).toBe('survey')
    expect(survey.prefersDocumentReading).toBe(true)
  })

  it('scores generic words as weak evidence instead of domain proof', () => {
    const intent = buildQueryIntent('主流给 agent 用的 RAG 方案是什么，embedding 架构是怎样的？')

    const ragFit = scoreEvidenceIntentFit(intent, {
      wikiId: 'rag-knowledge-graph',
      wikiTitle: 'RAG & Knowledge Graph',
      title: 'LightRAG Query Modes',
      excerpt: 'LightRAG uses hybrid retrieval, chunks, embeddings, and rerank context for RAG.',
    })
    const financeFit = scoreEvidenceIntentFit(intent, {
      wikiId: 'ai-finance',
      wikiTitle: 'AI Finance',
      title: 'Financial Foundation Models',
      excerpt: 'Financial time-series foundation models discuss market forecasting architecture.',
    })

    expect(ragFit.strong).toBe(true)
    expect(ragFit.margin).toBeGreaterThan(0.25)
    expect(financeFit.strong).toBe(false)
    expect(isEvidenceDomainConsistent(intent, {
      wikiId: 'ai-finance',
      wikiTitle: 'AI Finance',
      title: 'Financial Foundation Models',
      excerpt: 'Financial time-series foundation models discuss market forecasting architecture.',
    })).toBe(false)
  })

  it('normalizes boilerplate source titles for agent-facing reading packs', () => {
    expect(displaySourceTitle({
      title: 'OPEN ACCESS',
      sourceRef: '/tmp/light-rag-query-modes.pdf',
      rawPath: null,
      filePath: null,
    })).toBe('Light RAG Query Modes')
    expect(displaySourceTitle({
      title: 'LightRAG Query Modes',
      sourceRef: '/tmp/open-access.pdf',
      rawPath: null,
      filePath: null,
    })).toBe('LightRAG Query Modes')
  })

  it('allows strong neutral semantic evidence for future domains without weakening known-domain gates', () => {
    const intent = buildQueryIntent('新兴市场策略里最核心的风险轴是什么？')
    expect(intent.hasDomainSpecificIntent).toBe(false)
    expect(isStrongSemanticEvidence({
      intent,
      evidence: {
        title: '新兴市场阶段映射',
        excerpt: '核心框架：发展阶段轴。商业机会不是随机分布的。',
        score: {
          lexical: 0,
          embedding: 0.52,
          graph: 0,
          taxonomy: 0,
          metadata: 0,
          rerank: 0,
          total: 0.182,
        },
      },
    })).toBe(true)
    expect(isStrongSemanticEvidence({
      intent,
      evidence: {
        title: 'Unrelated benchmark appendix',
        excerpt: 'Alphabet soup and tomato sauce benchmark commands.',
        score: {
          lexical: 0,
          embedding: 0.46,
          graph: 0,
          taxonomy: 0,
          metadata: 0,
          rerank: 0,
          total: 0.161,
        },
      },
    })).toBe(false)
  })
})
