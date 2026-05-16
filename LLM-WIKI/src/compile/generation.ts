import type { ArtifactAnalysis, TopicProposal, ReviewTrigger, AnalysisCandidate } from './analysis'

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
}

export type ReviewEffect = ReviewTrigger & {
  artifactId: string
  evidence?: string[]
  confidence?: number
  suggestedActions?: string[]
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

const MIN_DURABLE_HEURISTIC_CONFIDENCE = 0.7

export type KnowledgeGenerationOptions = {
  sourceSlug?: string
}

export async function generateKnowledgeChanges(
  analysis: ArtifactAnalysis,
  options: KnowledgeGenerationOptions = {},
): Promise<KnowledgeGenerationResult> {
  const sourceSlug = options.sourceSlug ?? buildStableArtifactSlug(analysis)
  const topicSlugs = analysis.topics.map((topic) => topic.slug)
  const entityCandidates = removeSourceTitleHeuristics(analysis.candidateEntities, sourceSlug)
  const conceptCandidates = removeSourceTitleHeuristics(analysis.candidateConcepts, sourceSlug)
  const { durable: durableEntityCandidates, gated: gatedEntityCandidates } = partitionDurableCandidates(entityCandidates)
  const { durable: durableConceptCandidates, gated: gatedConceptCandidates } = partitionDurableCandidates(conceptCandidates)
  const entitySlugs = durableEntityCandidates.map((candidate) => candidate.slug)
  const conceptSlugs = durableConceptCandidates.map((candidate) => candidate.slug)

  const sourcePage: KnowledgePagePayload = {
    slug: sourceSlug,
    title: analysis.artifact.title,
    artifactId: analysis.artifactId,
    topics: topicSlugs,
    backlinks: [...entitySlugs, ...conceptSlugs],
    body: buildSourcePageBody(analysis, durableEntityCandidates, durableConceptCandidates),
  }

  const entityPages = durableEntityCandidates.map((candidate) => ({
    slug: candidate.slug,
    title: candidate.title,
    artifactId: analysis.artifactId,
    topics: topicSlugs,
    backlinks: [sourceSlug, ...conceptSlugs],
    body: [
      `# ${candidate.title}`,
      '',
      `- Source artifact: ${analysis.artifactId}`,
      `- Confidence: ${candidate.confidence}`,
      '',
      '## Evidence',
      ...candidate.evidence.map((evidence) => `- ${evidence}`),
      '',
      '## Related concepts',
      ...(durableConceptCandidates.length > 0 ? durableConceptCandidates.map((concept) => `- [[concepts/${concept.slug}|${concept.title}]]`) : ['- None detected']),
      '',
      '## Source backlink',
      `- [[sources/${sourceSlug}|${analysis.artifact.title}]]`,
    ].join('\n'),
  }))

  const conceptPages = durableConceptCandidates.map((candidate) => ({
    slug: candidate.slug,
    title: candidate.title,
    artifactId: analysis.artifactId,
    topics: topicSlugs,
    backlinks: [sourceSlug, ...entitySlugs],
    body: [
      `# ${candidate.title}`,
      '',
      `- Source artifact: ${analysis.artifactId}`,
      `- Confidence: ${candidate.confidence}`,
      '',
      '## Definition seed',
      `${candidate.title} is a candidate concept extracted from ${analysis.artifact.title}.`,
      '',
      '## Evidence',
      ...candidate.evidence.map((evidence) => `- ${evidence}`),
      '',
      '## Related entities',
      ...(durableEntityCandidates.length > 0 ? durableEntityCandidates.map((entity) => `- [[entities/${entity.slug}|${entity.title}]]`) : ['- None detected']),
      '',
      '## Source backlink',
      `- [[sources/${sourceSlug}|${analysis.artifact.title}]]`,
    ].join('\n'),
  }))

  const synthesisSuggestions = buildSynthesisSuggestions(
    analysis,
    sourceSlug,
    durableEntityCandidates,
    durableConceptCandidates,
  )
  const indexMutations = buildIndexMutations(sourcePage, entityPages, conceptPages, synthesisSuggestions)
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
    taxonomyEffects: buildTaxonomyEffects(analysis.topics),
    reviewEffects: buildReviewEffects(analysis, gatedEntityCandidates, gatedConceptCandidates),
  }
}

function buildSourcePageBody(
  analysis: ArtifactAnalysis,
  durableEntityCandidates: AnalysisCandidate[],
  durableConceptCandidates: AnalysisCandidate[],
): string {
  const entityLinks = durableEntityCandidates.length > 0
    ? durableEntityCandidates.map((candidate) => `- [[entities/${candidate.slug}|${candidate.title}]]`).join('\n')
    : '- None detected'

  const conceptLinks = durableConceptCandidates.length > 0
    ? durableConceptCandidates.map((candidate) => `- [[concepts/${candidate.slug}|${candidate.title}]]`).join('\n')
    : '- None detected'

  const topicLinks = analysis.topics.length > 0
    ? analysis.topics.map((topic) => `- ${topic.title} (${topic.confidence})`).join('\n')
    : '- None proposed'

  const relationHints = analysis.relationHints.length > 0
    ? analysis.relationHints.map((hint) => `- ${formatRelationHint(hint, durableEntityCandidates, durableConceptCandidates)}`).join('\n')
    : '- None'

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
    '## Topics',
    topicLinks,
    '',
    '## Entities',
    entityLinks,
    '',
    '## Concepts',
    conceptLinks,
    '',
    '## Relation hints',
    relationHints,
    '',
    '## Evidence preservation',
    'Source of truth: raw captured source material. This page is a derived index/summary and must not replace the raw evidence.',
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

function formatRelationHint(
  hint: ArtifactAnalysis['relationHints'][number],
  durableEntityCandidates: AnalysisCandidate[],
  durableConceptCandidates: AnalysisCandidate[],
): string {
  const fromEntity = durableEntityCandidates.find((candidate) => candidate.slug === hint.fromSlug)
  const toConcept = durableConceptCandidates.find((candidate) => candidate.slug === hint.toSlug)
  const from = fromEntity
    ? `[[entities/${fromEntity.slug}|${fromEntity.title}]]`
    : hint.fromSlug
  const to = toConcept
    ? `[[concepts/${toConcept.slug}|${toConcept.title}]]`
    : hint.toSlug

  return `${from} ${hint.kind} ${to} (${hint.confidence}) — ${hint.evidence}`
}

function buildSynthesisSuggestions(
  analysis: ArtifactAnalysis,
  sourceSlug: string,
  durableEntityCandidates: AnalysisCandidate[],
  durableConceptCandidates: AnalysisCandidate[],
): SynthesisSuggestionPayload[] {
  if (durableEntityCandidates.length === 0 || durableConceptCandidates.length === 0) {
    return []
  }

  const leadEntity = durableEntityCandidates[0]
  const leadConcept = durableConceptCandidates[0]
  const slug = `${sourceSlug}-synthesis`

  return [{
    slug,
    title: `${leadEntity.title} × ${leadConcept.title}`,
    rationale: 'The source ties at least one entity to at least one concept with usable confidence.',
    relatedPageSlugs: [sourceSlug, leadEntity.slug, leadConcept.slug],
    body: [
      `# ${leadEntity.title} × ${leadConcept.title}`,
      '',
      `This synthesis suggestion was generated from [[sources/${sourceSlug}|${analysis.artifact.title}]].`,
      '',
      `- Entity seed: [[entities/${leadEntity.slug}|${leadEntity.title}]]`,
      `- Concept seed: [[concepts/${leadConcept.slug}|${leadConcept.title}]]`,
      '',
      '## Why this exists',
      analysis.sourceSummary,
    ].join('\n'),
  }]
}

function buildIndexMutations(
  sourcePage: KnowledgePagePayload,
  entityPages: KnowledgePagePayload[],
  conceptPages: KnowledgePagePayload[],
  synthesisSuggestions: SynthesisSuggestionPayload[],
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

function buildTaxonomyEffects(topics: TopicProposal[]): TaxonomyEffect[] {
  return topics.map((topic) => ({
    action: 'propose-topic',
    slug: topic.slug,
    title: topic.title,
    confidence: topic.confidence,
    rationale: topic.rationale,
  }))
}

function buildReviewEffects(
  analysis: ArtifactAnalysis,
  gatedEntityCandidates: AnalysisCandidate[],
  gatedConceptCandidates: AnalysisCandidate[],
): ReviewEffect[] {
  return [
    ...analysis.reviewTriggers.map((trigger) => ({
      ...trigger,
      artifactId: analysis.artifactId,
    })),
    ...gatedEntityCandidates.map((candidate) => buildLowConfidenceGatingEffect(analysis.artifactId, 'entity', candidate)),
    ...gatedConceptCandidates.map((candidate) => buildLowConfidenceGatingEffect(analysis.artifactId, 'concept', candidate)),
  ]
}

function buildLowConfidenceGatingEffect(
  artifactId: string,
  candidateType: 'entity' | 'concept',
  candidate: AnalysisCandidate,
): ReviewEffect {
  return {
    artifactId,
    kind: 'low-confidence',
    severity: 'low',
    reason: `Low-confidence heuristic ${candidateType} "${candidate.title}" (${candidate.confidence.toFixed(2)}) was gated from durable wiki writes pending review.`,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    suggestedActions: [
      `Review whether "${candidate.title}" should become a durable ${candidateType} page.`,
      'Approve, rename/merge, or reject the candidate before hardening it into the wiki.',
    ],
  }
}

function partitionDurableCandidates(candidates: AnalysisCandidate[]): {
  durable: AnalysisCandidate[]
  gated: AnalysisCandidate[]
} {
  return candidates.reduce<{ durable: AnalysisCandidate[]; gated: AnalysisCandidate[] }>((accumulator, candidate) => {
    if (isDurableKnowledgeCandidate(candidate)) {
      accumulator.durable.push(candidate)
    } else {
      accumulator.gated.push(candidate)
    }

    return accumulator
  }, { durable: [], gated: [] })
}

function isDurableKnowledgeCandidate(candidate: AnalysisCandidate): boolean {
  return candidate.source === 'marker' || candidate.confidence >= MIN_DURABLE_HEURISTIC_CONFIDENCE
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
