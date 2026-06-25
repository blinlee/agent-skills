import { describe, expect, it } from 'vitest'
import { validateInboxQualityPlan } from '../../src/intake/quality-gate.js'
import type { NormalizedArtifact } from '../../src/types.js'

const artifact: NormalizedArtifact = {
  id: 'source-1',
  sourceRef: 'fixture.md',
  title: 'Fixture Source',
  content: 'Fixture Source explains a durable retrieval workflow with source-backed evidence.',
  summary: 'Fixture summary',
  tags: [],
  metadata: {},
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  sourceKind: 'md',
}

describe('inbox quality gate', () => {
  it('accepts source-backed quality plans for useful readable material', () => {
    const plan = validateInboxQualityPlan({
      artifact,
      plan: {
        schema: 'llm-wiki.inbox-quality.v1',
        status: 'ready',
        decision: 'accept',
        knowledgeValue: 'medium',
        readability: 'readable',
        duplicateAssessment: { status: 'new', matchedRefs: [] },
        sourceType: 'paper-note',
        reason: '这份材料有稳定知识价值，适合进入 wiki。',
        evidence: [{ quote: 'durable retrieval workflow with source-backed evidence' }],
      },
    })

    expect(plan.recommendedAction).toBe('accept')
    expect(plan.blockers).toEqual([])
  })

  it('rejects accepted material when evidence is not present in the source', () => {
    expect(() => validateInboxQualityPlan({
      artifact,
      plan: {
        schema: 'llm-wiki.inbox-quality.v1',
        status: 'ready',
        decision: 'accept',
        knowledgeValue: 'medium',
        readability: 'readable',
        duplicateAssessment: { status: 'new', matchedRefs: [] },
        sourceType: 'paper-note',
        reason: '证据必须来自原文。',
        evidence: [{ quote: 'this quote does not exist' }],
      },
    })).toThrow(/quality evidence quote is not present/u)
  })

  it('blocks duplicate material from being accepted as a fresh source', () => {
    expect(() => validateInboxQualityPlan({
      artifact,
      plan: {
        schema: 'llm-wiki.inbox-quality.v1',
        status: 'ready',
        decision: 'accept',
        knowledgeValue: 'medium',
        readability: 'readable',
        duplicateAssessment: { status: 'duplicate', matchedRefs: ['sources/existing'] },
        sourceType: 'paper-note',
        reason: '重复材料不能作为新材料入库。',
        evidence: [{ quote: 'durable retrieval workflow' }],
      },
    })).toThrow(/accepted material cannot be marked as duplicate/u)
  })

  it('requires non-accept decisions to stay in needs-review status', () => {
    expect(() => validateInboxQualityPlan({
      artifact,
      plan: {
        schema: 'llm-wiki.inbox-quality.v1',
        status: 'ready',
        decision: 'reject',
        recommendedAction: 'reject',
        knowledgeValue: 'none',
        readability: 'readable',
        duplicateAssessment: { status: 'new', matchedRefs: [] },
        sourceType: 'scratch',
        reason: '低价值材料应该阻塞，而不是标为 ready。',
        evidence: [{ quote: 'durable retrieval workflow' }],
      },
    })).toThrow(/ready quality plan must use decision accept/u)
  })

  it('blocks low-value material from ready accept without an explicit override', () => {
    expect(() => validateInboxQualityPlan({
      artifact,
      plan: {
        schema: 'llm-wiki.inbox-quality.v1',
        status: 'ready',
        decision: 'accept',
        knowledgeValue: 'low',
        readability: 'readable',
        duplicateAssessment: { status: 'new', matchedRefs: [] },
        sourceType: 'scratch',
        reason: '材料只有边缘参考价值。',
        evidence: [{ quote: 'durable retrieval workflow' }],
      },
    })).toThrow(/accepted low-value material requires overrideReason/u)
  })

  it('allows low-value material only when the override reason is explicit', () => {
    const plan = validateInboxQualityPlan({
      artifact,
      plan: {
        schema: 'llm-wiki.inbox-quality.v1',
        status: 'ready',
        decision: 'accept',
        knowledgeValue: 'low',
        readability: 'readable',
        duplicateAssessment: { status: 'new', matchedRefs: [] },
        sourceType: 'scratch',
        reason: '材料只有边缘参考价值。',
        overrideReason: '用户明确要求保留这份边缘案例，用于后续比较低质量材料如何影响检索。',
        evidence: [{ quote: 'durable retrieval workflow' }],
      },
    })

    expect(plan.knowledgeValue).toBe('low')
    expect(plan.overrideReason).toContain('用户明确要求保留')
  })
})
