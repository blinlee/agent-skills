import { describe, expect, it } from 'vitest'
import { generateKnowledgeChanges } from '../../src/compile/generation.js'
import { normalizeSemanticCurationPlan, validateSemanticCurationPlan } from '../../src/compile/semantic-curation.js'
import type { NormalizedArtifact } from '../../src/types.js'

describe('curated knowledge generation', () => {
  it('materializes only curation-backed semantic pages and links them from the source card', async () => {
    const source = artifact({
      title: 'Runtime Notes',
      content: [
        '# Runtime Notes',
        '',
        'OpenClaw keeps compilation deterministic.',
        'Compilation is the durable boundary in this workflow.',
        'The notes summarize a recurring wiki intake workflow.',
      ].join('\n'),
    })
    const curation = validateSemanticCurationPlan({
      artifact: source,
      plan: normalizeSemanticCurationPlan({
        schema: 'llm-wiki.semantic-curation.v1',
        status: 'ready',
        summary: '这份材料说明 OpenClaw 如何把编译与 wiki 入库流程保持确定性。',
        entities: [{
          title: 'OpenClaw',
          slug: 'openclaw',
          kind: 'system',
          description: 'OpenClaw 是材料中明确出现的系统实体。',
          evidence: [{ quote: 'OpenClaw keeps compilation deterministic.' }],
        }],
        concepts: [{
          title: 'Compilation Boundary',
          slug: 'compilation-boundary',
          description: '编译边界是流程中需要稳定维护的概念。',
          evidence: [{ quote: 'Compilation is the durable boundary in this workflow.' }],
        }],
        syntheses: [{
          title: 'Wiki Intake Workflow',
          slug: 'wiki-intake-workflow',
          description: '材料适合归入 wiki 入库流程综述主题。',
          evidence: [{ quote: 'The notes summarize a recurring wiki intake workflow.' }],
        }],
        rejections: [{
          text: 'Runtime Notes',
          reason: '标题本身不是稳定实体。',
        }],
      }),
    })

    const result = await generateKnowledgeChanges(source, curation)

    expect(result.sourcePage.slug).toBe('runtime-notes')
    expect(result.sourcePage.body).toContain('- 语义整理: curation-plan-backed')
    expect(result.sourcePage.body).toContain('[[readings/runtime-notes|完整原文]]')
    expect(result.sourcePage.body).toContain('[[entities/openclaw|OpenClaw]]')
    expect(result.sourcePage.body).toContain('[[concepts/compilation-boundary|Compilation Boundary]]')
    expect(result.sourcePage.body).toContain('[[syntheses/wiki-intake-workflow|Wiki Intake Workflow]]')
    expect(result.sourcePage.body).toContain('Runtime Notes: 标题本身不是稳定实体。')
    expect(result.readingPage.body).toContain('## 原文全文')
    expect(result.readingPage.body).toContain('OpenClaw keeps compilation deterministic.')
    expect(result.entityPages).toEqual([
      expect.objectContaining({ slug: 'openclaw', title: 'OpenClaw' }),
    ])
    expect(result.conceptPages).toEqual([
      expect.objectContaining({ slug: 'compilation-boundary', title: 'Compilation Boundary' }),
    ])
    expect(result.synthesisPages).toEqual([
      expect.objectContaining({ slug: 'wiki-intake-workflow', title: 'Wiki Intake Workflow' }),
    ])
    expect(result.indexMutations.map((mutation) => mutation.value)).toEqual(expect.arrayContaining([
      '- [[sources/runtime-notes|Runtime Notes]]',
      '- [[readings/runtime-notes|Runtime Notes - 完整原文]]',
      '- [[entities/openclaw|OpenClaw]]',
      '- [[concepts/compilation-boundary|Compilation Boundary]]',
      '- [[syntheses/wiki-intake-workflow|Wiki Intake Workflow]]',
    ]))
    expect(result.taxonomyEffects).toEqual([])
    expect(result.reviewEffects).toEqual([])
  })

  it('uses the artifact id only when the title cannot form a slug', async () => {
    const source = artifact({
      id: 'slug-nonascii',
      title: '编译笔记',
      content: 'OpenClaw keeps compilation deterministic.',
    })
    const curation = validateSemanticCurationPlan({
      artifact: source,
      plan: normalizeSemanticCurationPlan({
        schema: 'llm-wiki.semantic-curation.v1',
        status: 'ready',
        summary: '中文标题材料。',
        entities: [],
        concepts: [],
        notes: ['只需要资料卡与完整原文入口。'],
      }),
    })

    const result = await generateKnowledgeChanges(source, curation)

    expect(result.sourcePage.slug).toBe('slug-nonascii')
    expect(result.indexMutations).toContainEqual(expect.objectContaining({
      target: 'wiki/index.md',
      value: '- [[sources/slug-nonascii|编译笔记]]',
    }))
  })
})

function artifact(overrides: Partial<NormalizedArtifact>): NormalizedArtifact {
  const now = '2026-06-22T00:00:00.000Z'
  return {
    id: 'artifact-1',
    sourceKind: 'md',
    sourceRef: '/tmp/runtime-notes.md',
    title: 'Runtime Notes',
    content: 'OpenClaw keeps compilation deterministic.',
    summary: '',
    tags: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
