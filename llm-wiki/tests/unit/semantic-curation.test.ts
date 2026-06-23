import { describe, expect, it } from 'vitest'
import {
  normalizeSemanticCurationPlan,
  validateSemanticCurationPlan,
} from '../../src/compile/semantic-curation.js'
import type { NormalizedArtifact } from '../../src/types.js'

describe('semantic curation contract', () => {
  it('validates a curation plan against exact source evidence', () => {
    const plan = validateSemanticCurationPlan({
      artifact: artifact(),
      plan: normalizeSemanticCurationPlan({
        schema: 'llm-wiki.semantic-curation.v1',
        status: 'ready',
        summary: '这份材料说明 OpenClaw 用确定性队列把 intake、review 和 query 串起来。',
        entities: [{
          title: 'OpenClaw',
          slug: 'openclaw',
          kind: 'system',
          description: '一个用确定性队列组织 wiki 入库流程的系统。',
          evidence: [{ quote: 'OpenClaw keeps intake deterministic.' }],
        }],
        concepts: [{
          title: 'Deterministic Intake',
          slug: 'deterministic-intake',
          description: '入库动作需要可复现、可审计，而不是靠运行时猜测。',
          evidence: [{ quote: 'Semantic curation is explicit, not decided by title regexes.' }],
        }],
        syntheses: [{
          title: 'Wiki Intake Workflow',
          slug: 'wiki-intake-workflow',
          description: '本材料可归入 wiki 入库流程主题。',
          evidence: [{ quote: 'The wiki card links to a full reading page.' }],
        }],
        rejections: [{
          text: 'Title regex topic',
          reason: '标题规则不是语义依据。',
        }],
      }),
    })

    expect(plan.entities).toHaveLength(1)
    expect(plan.concepts).toHaveLength(1)
    expect(plan.syntheses).toHaveLength(1)
  })

  it('rejects curation evidence that is not present in the source text', () => {
    expect(() => validateSemanticCurationPlan({
      artifact: artifact(),
      plan: normalizeSemanticCurationPlan({
        schema: 'llm-wiki.semantic-curation.v1',
        status: 'ready',
        summary: '错误计划。',
        entities: [{
          title: 'Missing System',
          kind: 'system',
          description: '这个实体没有原文证据。',
          evidence: [{ quote: 'This quote does not exist in the source.' }],
        }],
        concepts: [],
      }),
    })).toThrow(/evidence quote is not present/)
  })

  it('allows a ready no-page decision only when the plan explains it', () => {
    expect(() => validateSemanticCurationPlan({
      artifact: artifact(),
      plan: normalizeSemanticCurationPlan({
        schema: 'llm-wiki.semantic-curation.v1',
        status: 'ready',
        summary: '没有可建页内容。',
        entities: [],
        concepts: [],
      }),
    })).toThrow(/must either accept pages or explain/)

    expect(validateSemanticCurationPlan({
      artifact: artifact(),
      plan: normalizeSemanticCurationPlan({
        schema: 'llm-wiki.semantic-curation.v1',
        status: 'ready',
        summary: '没有可建页内容。',
        entities: [],
        concepts: [],
        notes: ['这份材料只是临时索引，不适合创建稳定语义页。'],
      }),
    }).notes).toHaveLength(1)
  })
})

function artifact(): NormalizedArtifact {
  const now = '2026-06-22T00:00:00.000Z'
  return {
    id: 'artifact-1',
    sourceKind: 'md',
    sourceRef: '/tmp/openclaw.md',
    title: 'OpenClaw Intake Notes',
    content: [
      '# OpenClaw Intake Notes',
      '',
      'OpenClaw keeps intake deterministic.',
      'Semantic curation is explicit, not decided by title regexes.',
      'The wiki card links to a full reading page.',
    ].join('\n'),
    summary: '',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  }
}
