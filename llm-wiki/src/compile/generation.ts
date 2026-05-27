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

const MIN_REVIEW_CONFIDENCE = 0.7

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
    `- Artifact ID: ${analysis.artifactId}`,
    `- Source kind: ${analysis.artifact.sourceKind}`,
    `- Source ref: ${analysis.artifact.sourceRef}`,
    `- Analysis confidence: ${analysis.confidence}`,
    '',
    '## Summary',
    analysis.sourceSummary,
    '',
    '## Evidence preservation',
    'Source of truth: raw captured source material. This page is a derived index/summary and must not replace the raw evidence.',
    '',
    'Semantic candidates are stored in review and taxonomy proposal files until approved. Unapproved candidates are intentionally not linked from this page.',
    '',
    '### Verbatim evidence samples',
    ...selectVerbatimEvidenceSamples(analysis.artifact.content).map((line) => `- ${line}`),
    '',
    '### Caveats / edge-case signals',
    ...selectCaveatSignals(analysis.artifact.content),
    '',
    '## Source excerpt',
    analysis.artifact.content.slice(0, 1200),
  ].join('\n')
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

  return caveats.length > 0 ? caveats : ['- None detected; review raw source before treating summary as complete.']
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
    ...analysis.reviewTriggers.map((trigger) => ({
      ...trigger,
      artifactId: analysis.artifactId,
    })),
    ...entityCandidates.map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'entity', candidate)),
    ...conceptCandidates.map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'concept', candidate)),
  ]
}

function buildCandidateReviewEffect(
  artifactId: string,
  candidateType: 'entity' | 'concept',
  candidate: AnalysisCandidate,
): ReviewEffect {
  const lowConfidence = candidate.source === 'heuristic' && candidate.confidence < MIN_REVIEW_CONFIDENCE

  return {
    artifactId,
    kind: lowConfidence ? 'low-confidence' : 'semantic-candidate',
    severity: 'low',
    reason: lowConfidence
      ? `Low-confidence heuristic ${candidateType} "${candidate.title}" (${candidate.confidence.toFixed(2)}) was gated from durable wiki writes pending review.`
      : `Candidate ${candidateType} "${candidate.title}" (${candidate.confidence.toFixed(2)}) requires review before becoming durable wiki semantics.`,
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
      `Review whether "${candidate.title}" should become a durable ${candidateType} page.`,
      'Approve, rename/merge, or reject the candidate before hardening it into the wiki.',
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
