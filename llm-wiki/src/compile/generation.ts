import type { ArtifactAnalysis, TopicProposal, ReviewTrigger, AnalysisCandidate } from './analysis.js'

export type KnowledgePagePayload = {
  slug: string
  title: string
  body: string
  artifactId?: string
  topics: string[]
  backlinks: string[]
}

export type SynthesisSuggestionPayload = {
  slug: string
  title: string
  body: string
  rationale: string
  relatedPageSlugs: string[]
}

export type FileMutationInstruction = {
  target: string
  op: 'append'
  value: string
}

export type TaxonomyEffect = {
  action: 'propose-topic'
  slug: string
  title: string
  confidence: number
  rationale: string
  source: {
    slug: string
    title: string
    artifactId: string
  }
}

export type ReviewEffect = ReviewTrigger & {
  artifactId: string
  evidence?: string[]
  confidence?: number
  suggestedActions?: string[]
  candidate?: {
    kind: 'entity' | 'concept'
    slug: string
    title: string
    confidence: number
    source: AnalysisCandidate['source']
    evidence: string[]
  }
}

export type KnowledgeGenerationResult = {
  artifactId: string
  sourcePage: KnowledgePagePayload
  entityPages: KnowledgePagePayload[]
  conceptPages: KnowledgePagePayload[]
  synthesisSuggestions: SynthesisSuggestionPayload[]
  indexMutations: FileMutationInstruction[]
  logMutations: FileMutationInstruction[]
  taxonomyEffects: TaxonomyEffect[]
  reviewEffects: ReviewEffect[]
}

export type KnowledgeGenerationOptions = {
  sourceSlug?: string
}

export async function generateKnowledgeChanges(
  analysis: ArtifactAnalysis,
  options: KnowledgeGenerationOptions = {},
): Promise<KnowledgeGenerationResult> {
  const sourceSlug = options.sourceSlug ?? buildStableArtifactSlug(analysis)
  const entityCandidates = removeSourceTitleHeuristics(analysis.candidateEntities, sourceSlug)
  const conceptCandidates = removeSourceTitleHeuristics(analysis.candidateConcepts, sourceSlug)

  const sourcePage: KnowledgePagePayload = {
    slug: sourceSlug,
    title: analysis.artifact.title,
    artifactId: analysis.artifactId,
    topics: [],
    backlinks: [],
    body: buildSourcePageBody(analysis),
  }

  const entityPages: KnowledgePagePayload[] = []
  const conceptPages: KnowledgePagePayload[] = []

  const synthesisSuggestions: SynthesisSuggestionPayload[] = []
  const indexMutations = buildIndexMutations(sourcePage, entityPages, conceptPages)
  const logMutations = [{
    target: 'wiki/log.md',
    op: 'append' as const,
    value: `${analysis.artifact.updatedAt}\tcompiled\t${analysis.artifactId}\t${sourceSlug}`,
  }]

  return {
    artifactId: analysis.artifactId,
    sourcePage,
    entityPages,
    conceptPages,
    synthesisSuggestions,
    indexMutations,
    logMutations,
    taxonomyEffects: buildTaxonomyEffects(analysis.topics, sourcePage),
    reviewEffects: buildReviewEffects(analysis, entityCandidates, conceptCandidates),
  }
}

function buildSourcePageBody(analysis: ArtifactAnalysis): string {
  return [
    `# ${analysis.artifact.title}`,
    '',
    `- 资料 ID: ${analysis.artifactId}`,
    `- 来源类型: ${sourceKindLabel(analysis.artifact.sourceKind)}`,
    `- 来源引用: ${analysis.artifact.sourceRef}`,
    `- 分析置信度: ${analysis.confidence}`,
    '',
    '## 摘要',
    buildFastReadSummary(analysis),
    '',
    '## 证据说明',
    '原始采集材料是事实依据。本页是派生的索引和速读摘要，用于定位与浏览，不能替代原始证据。',
    '',
    '候选语义会先保存在内部提案状态中；未经批准的候选项不会从本页直接写成稳定链接。',
    '',
    '### 原文证据片段',
    ...selectVerbatimEvidenceSamples(analysis.artifact.content).map((line) => `- ${line}`),
    '',
    '### 注意点 / 边界信号',
    ...selectCaveatSignals(analysis.artifact.content),
    '',
    '## 原文摘录',
    analysis.artifact.content.slice(0, 1200),
  ].join('\n')
}

function buildFastReadSummary(analysis: ArtifactAnalysis): string {
  return `这是一份${sourceKindLabel(analysis.artifact.sourceKind)}来源材料，标题为《${analysis.artifact.title}》。当前编译置信度为 ${analysis.confidence}。本页用于快速了解资料身份、证据位置和后续治理状态；具体论断请以下方原文摘录和归档原始材料为准。`
}

function sourceKindLabel(sourceKind: ArtifactAnalysis['artifact']['sourceKind']): string {
  const labels: Record<ArtifactAnalysis['artifact']['sourceKind'], string> = {
    md: 'Markdown',
    txt: '文本',
    url: '网页',
    repo: '代码仓库',
  }

  return labels[sourceKind]
}

function selectVerbatimEvidenceSamples(content: string): string[] {
  const candidates = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter((line) => !/^entity\s*:/i.test(line) && !/^concept\s*:/i.test(line))

  return (candidates.length > 0 ? candidates : [content.trim()])
    .filter(Boolean)
    .slice(0, 5)
    .map((line) => line.length > 240 ? `${line.slice(0, 237)}...` : line)
}

function selectCaveatSignals(content: string): string[] {
  const caveatPattern = /\b(however|but|except|unless|edge case|caveat|risk|conflict|contradict|deprecated|uncertain|unknown)\b/i
  const caveats = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => caveatPattern.test(line))
    .slice(0, 5)
    .map((line) => `- ${line.length > 240 ? `${line.slice(0, 237)}...` : line}`)

  return caveats.length > 0 ? caveats : ['- 未检测到明显边界信号；在将摘要视为完整结论前仍需核对原始材料。']
}

function buildIndexMutations(
  sourcePage: KnowledgePagePayload,
  entityPages: KnowledgePagePayload[],
  conceptPages: KnowledgePagePayload[],
): FileMutationInstruction[] {
  return [
    {
      target: 'wiki/index.md',
      op: 'append',
      value: `- [[sources/${sourcePage.slug}|${sourcePage.title}]]`,
    },
    ...entityPages.map((page) => ({
      target: 'wiki/index.md',
      op: 'append' as const,
      value: `- [[entities/${page.slug}|${page.title}]]`,
    })),
    ...conceptPages.map((page) => ({
      target: 'wiki/index.md',
      op: 'append' as const,
      value: `- [[concepts/${page.slug}|${page.title}]]`,
    })),
  ]
}

function buildTaxonomyEffects(
  topics: TopicProposal[],
  sourcePage: Pick<KnowledgePagePayload, 'slug' | 'title' | 'artifactId'>,
): TaxonomyEffect[] {
  return topics.map((topic) => ({
    action: 'propose-topic',
    slug: topic.slug,
    title: topic.title,
    confidence: topic.confidence,
    rationale: topic.rationale,
    source: {
      slug: sourcePage.slug,
      title: sourcePage.title,
      artifactId: sourcePage.artifactId ?? '',
    },
  }))
}

function buildReviewEffects(
  analysis: ArtifactAnalysis,
  entityCandidates: AnalysisCandidate[],
  conceptCandidates: AnalysisCandidate[],
): ReviewEffect[] {
  return [
    ...analysis.reviewTriggers
      .filter((trigger) => trigger.kind !== 'low-confidence')
      .map((trigger) => ({
        ...trigger,
        artifactId: analysis.artifactId,
      })),
    ...entityCandidates
      .filter((candidate) => candidate.source === 'marker')
      .map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'entity', candidate)),
    ...conceptCandidates
      .filter((candidate) => candidate.source === 'marker')
      .map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'concept', candidate)),
  ]
}

function buildCandidateReviewEffect(
  artifactId: string,
  candidateType: 'entity' | 'concept',
  candidate: AnalysisCandidate,
): ReviewEffect {
  return {
    artifactId,
    kind: 'semantic-candidate',
    severity: 'low',
    reason: `显式${candidateType === 'entity' ? '实体' : '概念'}候选“${candidate.title}”（${candidate.confidence.toFixed(2)}）需要批准后才能成为稳定 wiki 语义。`,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    candidate: {
      kind: candidateType,
      slug: candidate.slug,
      title: candidate.title,
      confidence: candidate.confidence,
      source: candidate.source,
      evidence: candidate.evidence,
    },
    suggestedActions: [
      `判断“${candidate.title}”是否应成为稳定${candidateType === 'entity' ? '实体' : '概念'}页面。`,
      '在写入稳定 wiki 前，先批准、重命名/合并或拒绝该候选项。',
    ],
  }
}

function removeSourceTitleHeuristics(candidates: AnalysisCandidate[], sourceSlug: string): AnalysisCandidate[] {
  return candidates.filter((candidate) => !(candidate.source === 'heuristic' && candidate.slug === sourceSlug))
}

function buildStableArtifactSlug(analysis: ArtifactAnalysis): string {
  return stableSlug(analysis.artifact.title, analysis.artifactId)
}

function stableSlug(value: string, fallback: string): string {
  const slug = slugify(value)
  return slug.length > 0 ? slug : fallback
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
