import type { NormalizedArtifact } from '../types'

export type AnalysisCandidate = {
  slug: string
  title: string
  confidence: number
  source: 'marker' | 'heuristic'
  evidence: string[]
}

export type TopicProposal = {
  slug: string
  title: string
  confidence: number
  rationale: string
  matchedFrom: Array<'entity' | 'concept' | 'title'>
}

export type RelationHint = {
  fromSlug: string
  toSlug: string
  kind: 'mentions' | 'relates-to'
  confidence: number
  evidence: string
}

export type ReviewTrigger = {
  kind: 'semantic-candidate' | 'low-confidence' | 'ambiguous-classification' | 'sparse-artifact'
  severity: 'low' | 'medium'
  reason: string
}

export type ArtifactAnalysis = {
  artifact: NormalizedArtifact
  artifactId: string
  sourceSummary: string
  candidateEntities: AnalysisCandidate[]
  candidateConcepts: AnalysisCandidate[]
  topics: TopicProposal[]
  relationHints: RelationHint[]
  reviewTriggers: ReviewTrigger[]
  confidence: number
}

const ENTITY_MARKER_RE = /^(?:entity|entities)\s*:\s*(.+)$/i
const CONCEPT_MARKER_RE = /^(?:concept|concepts)\s*:\s*(.+)$/i
const CAPITALIZED_PHRASE_RE = /\b([A-Z][a-zA-Z0-9]+(?:[ -][A-Z][a-zA-Z0-9]+){0,3})\b/g
const CONCEPT_TERM_RE = /\b([a-z][a-z-]{4,}(?:tion|sion|ment|ness|ity|ism|ics))\b/g
const GENERIC_ENTITY_WORDS = new Set([
  'entity',
  'entities',
  'concept',
  'concepts',
  'notes',
  'repository',
  'scan',
  'deep',
  'analysis',
  'source',
  'scope',
  'files',
  'captured',
  'readme',
  'api',
  'overview',
  'example',
  'examples',
  'setup',
  'usage',
  'guide',
  'guides',
  'reference',
  'references',
  'introduction',
  'intro',
  'documentation',
  'document',
  'docs',
  'doc',
  'this',
  'that',
  'these',
  'those',
  'it',
])
const SENTENCE_LEAD_ENTITY_STOPWORDS = new Set(['this', 'that', 'these', 'those', 'it'])
const LABEL_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'our', 'the', 'to', 'using', 'use', 'we', 'with',
])
const LABEL_NOISE_WORDS = new Set([
  'complete',
  'official',
  'documentation',
  'document',
  'docs',
  'reference',
  'references',
  'overview',
  'guide',
  'guides',
  'introduction',
  'lessons',
  'building',
  'built',
  'effective',
  'related',
  'saved',
  'date',
  'source',
  'author',
  'title',
  'summary',
])
const REPO_GENERIC_ENTITY_SUFFIXES = new Set([
  'readme',
  'guide',
  'guides',
  'overview',
  'reference',
  'references',
  'api',
  'doc',
  'docs',
  'documentation',
  'example',
  'examples',
  'package',
  'packages',
])
const REPO_WRAPPER_LINE_PATTERNS = [
  /^(?:Repository|Source path|Scan mode|Scope|Deep analysis|Files discovered):/i,
  /^Captured files:$/i,
  /^- \[(?:readme|docs|sample)\]/i,
  /^- \[omitted:/i,
  /^--- .* \((?:readme|docs|sample)\) ---$/i,
] as const
const MAX_CANDIDATES = 6
const MAX_TOPICS = 8

export async function analyzeArtifact(artifact: NormalizedArtifact): Promise<ArtifactAnalysis> {
  const analyzableContent = stripAnalyzerBoilerplate(artifact.content)
  const sourceMapArtifact = isSourceMapArtifact(artifact, analyzableContent)
  const content = normalizeWhitespace(analyzableContent)
  const lines = analyzableContent.split('\n').map((line) => line.trim()).filter(Boolean)

  const markerEntities = extractMarkerCandidates(lines, ENTITY_MARKER_RE, 'marker', 0.94)
  const markerConcepts = extractMarkerCandidates(lines, CONCEPT_MARKER_RE, 'marker', 0.91)

  const heuristicEntities = sourceMapArtifact ? [] : extractHeuristicEntities(artifact, analyzableContent)
  const heuristicConcepts = sourceMapArtifact ? [] : extractHeuristicConcepts(artifact, analyzableContent)

  const candidateEntities = mergeStructuredAndHeuristicCandidates({
    sourceKind: artifact.sourceKind,
    markerCandidates: markerEntities,
    heuristicCandidates: heuristicEntities,
  }).slice(0, MAX_CANDIDATES)
  const candidateConcepts = mergeStructuredAndHeuristicCandidates({
    sourceKind: artifact.sourceKind,
    markerCandidates: markerConcepts,
    heuristicCandidates: heuristicConcepts,
  }).slice(0, MAX_CANDIDATES)

  const topics = sourceMapArtifact && markerEntities.length === 0 && markerConcepts.length === 0
    ? []
    : buildTopicProposals(artifact.title, candidateEntities, candidateConcepts).slice(0, MAX_TOPICS)
  const relationHints = buildRelationHints(candidateEntities, candidateConcepts, artifact.title)
  const reviewTriggers = buildReviewTriggers(candidateEntities, candidateConcepts, topics, { sourceMapArtifact })

  return {
    artifact,
    artifactId: artifact.id,
    sourceSummary: buildSourceSummary(artifact.title, content),
    candidateEntities,
    candidateConcepts,
    topics,
    relationHints,
    reviewTriggers,
    confidence: computeOverallConfidence(candidateEntities, candidateConcepts, topics),
  }
}

function buildSourceSummary(title: string, content: string): string {
  const lead = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !ENTITY_MARKER_RE.test(line) && !CONCEPT_MARKER_RE.test(line))
    .join(' ')

  const summaryLead = lead.slice(0, 220).trim()
  return summaryLead.length > 0 ? `${title}: ${summaryLead}` : title
}

function extractMarkerCandidates(
  lines: string[],
  pattern: RegExp,
  source: AnalysisCandidate['source'],
  confidence: number,
): AnalysisCandidate[] {
  const candidates: AnalysisCandidate[] = []

  for (const line of lines) {
    const match = line.match(pattern)
    if (!match) {
      continue
    }

    for (const value of splitMarkerValues(match[1])) {
      candidates.push({
        slug: slugify(value),
        title: toDisplayTitle(value),
        confidence,
        source,
        evidence: [line],
      })
    }
  }

  return candidates.filter((candidate) => candidate.slug.length > 0)
}

type HeuristicEntityMatch = {
  value: string
  slug: string
  evidence: string
  fromMarkdownHeading: boolean
  sentenceLeading: boolean
}

type HeuristicEntityStats = {
  total: number
  nonHeading: number
}

function extractHeuristicEntities(artifact: NormalizedArtifact, content: string): AnalysisCandidate[] {
  const matches = collectHeuristicEntityMatches(artifact.title, content)
  const stats = summarizeHeuristicEntityMatches(matches)
  const candidates: AnalysisCandidate[] = []

  for (const match of matches) {
    if (!isAllowedHeuristicEntityMatch(match, artifact.sourceKind, stats.get(match.slug))) {
      continue
    }

    candidates.push({
      slug: match.slug,
      title: match.value,
      confidence: 0.58,
      source: 'heuristic',
      evidence: [match.evidence],
    })
  }

  return candidates
}

function collectHeuristicEntityMatches(title: string, content: string): HeuristicEntityMatch[] {
  const lines = [title, ...content.split('\n')]
  const matches: HeuristicEntityMatch[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const headingText = unwrapMarkdownHeading(line)
    const analyzableLine = headingText ?? line

    for (const match of analyzableLine.matchAll(CAPITALIZED_PHRASE_RE)) {
      const value = (match[1] ?? '').trim()
      const slug = slugify(value)
      if (!value || !slug) {
        continue
      }

      matches.push({
        value,
        slug,
        evidence: value,
        fromMarkdownHeading: Boolean(headingText),
        sentenceLeading: isSentenceLeadingMatch(analyzableLine, match.index ?? 0),
      })
    }
  }

  return matches
}

function summarizeHeuristicEntityMatches(matches: HeuristicEntityMatch[]): Map<string, HeuristicEntityStats> {
  const stats = new Map<string, HeuristicEntityStats>()

  for (const match of matches) {
    const existing = stats.get(match.slug) ?? { total: 0, nonHeading: 0 }
    stats.set(match.slug, {
      total: existing.total + 1,
      nonHeading: existing.nonHeading + (match.fromMarkdownHeading ? 0 : 1),
    })
  }

  return stats
}

function isAllowedHeuristicEntityMatch(
  match: HeuristicEntityMatch,
  sourceKind: NormalizedArtifact['sourceKind'],
  stats?: HeuristicEntityStats,
): boolean {
  const normalized = match.value.toLowerCase()
  if (GENERIC_ENTITY_WORDS.has(normalized)) {
    return false
  }

  if (match.sentenceLeading && SENTENCE_LEAD_ENTITY_STOPWORDS.has(normalized)) {
    return false
  }

  if (sourceKind !== 'repo') {
    return true
  }

  if (isGenericRepoEntityPhrase(match.value)) {
    return false
  }

  if (match.fromMarkdownHeading && (stats?.nonHeading ?? 0) === 0) {
    return false
  }

  return true
}

function isGenericRepoEntityPhrase(value: string): boolean {
  const tokens = value
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter(Boolean)

  if (tokens.length === 0) {
    return false
  }

  if (tokens.every((token) => GENERIC_ENTITY_WORDS.has(token) || REPO_GENERIC_ENTITY_SUFFIXES.has(token))) {
    return true
  }

  const lastToken = tokens[tokens.length - 1]
  return REPO_GENERIC_ENTITY_SUFFIXES.has(lastToken) && tokens.length <= 2 && !hasBrandLikeSignal(value)
}

function hasBrandLikeSignal(value: string): boolean {
  return value.split(/[-_\s]+/).some((token) => /[a-z][A-Z]/.test(token) || /\d/.test(token))
}

function unwrapMarkdownHeading(line: string): string | null {
  const match = line.match(/^#{1,6}\s+(.+)$/)
  return match?.[1]?.trim() ?? null
}

function isSentenceLeadingMatch(line: string, matchIndex: number): boolean {
  const prefix = line.slice(0, matchIndex).trimEnd()
  return prefix.length === 0 || /[.!?]\s*$/.test(prefix)
}

function extractHeuristicConcepts(artifact: NormalizedArtifact, content: string): AnalysisCandidate[] {
  const candidates: AnalysisCandidate[] = extractTitleConceptCandidates(artifact.title)

  const repeatedTerms = countConceptTerms(`${artifact.title}\n${content}`)
  for (const [value, count] of repeatedTerms) {
    if (count < 2 || !isControlledLabel(value, { allowSingleTechnicalToken: false })) {
      continue
    }
    candidates.push({
      slug: slugify(value),
      title: toDisplayTitle(value),
      confidence: 0.56,
      source: 'heuristic',
      evidence: [`Repeated domain term: ${value}`],
    })
  }

  return dedupeCandidates(candidates)
}

function countConceptTerms(text: string): Map<string, number> {
  const counts = new Map<string, number>()

  for (const match of text.toLowerCase().matchAll(CONCEPT_TERM_RE)) {
    const value = (match[1] ?? '').trim()
    if (!value) {
      continue
    }
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return counts
}

function extractTitleConceptCandidates(title: string): AnalysisCandidate[] {
  const phrases = deriveControlledTitlePhrases(title)
  return phrases.map((phrase) => ({
    slug: slugify(phrase),
    title: toDisplayTitle(phrase),
    confidence: 0.72,
    source: 'heuristic' as const,
    evidence: [`Title phrase: ${phrase}`],
  }))
}

function buildTopicProposals(
  title: string,
  entities: AnalysisCandidate[],
  concepts: AnalysisCandidate[],
): TopicProposal[] {
  const proposals: TopicProposal[] = []

  for (const concept of concepts) {
    if (!isTaxonomyEligibleCandidate(concept)) {
      continue
    }
    proposals.push({
      slug: concept.slug,
      title: concept.title,
      confidence: Math.max(0.7, concept.confidence),
      rationale: `Derived from controlled concept candidate "${concept.title}".`,
      matchedFrom: concept.evidence.some((evidence) => evidence.startsWith('Title phrase:')) ? ['title', 'concept'] : ['concept'],
    })
  }

  for (const entity of entities) {
    if (!isTaxonomyEligibleCandidate(entity)) {
      continue
    }
    proposals.push({
      slug: entity.slug,
      title: entity.title,
      confidence: Math.max(0.68, entity.confidence - 0.08),
      rationale: `Derived from controlled entity candidate "${entity.title}".`,
      matchedFrom: ['entity'],
    })
  }

  if (proposals.length === 0) {
    for (const phrase of deriveControlledTitlePhrases(title).slice(0, 2)) {
      proposals.push({
        slug: slugify(phrase),
        title: toDisplayTitle(phrase),
        confidence: 0.64,
        rationale: 'Derived from source title as a provisional browse topic.',
        matchedFrom: ['title'],
      })
    }
  }

  return dedupeTopics(proposals)
}

function buildRelationHints(entities: AnalysisCandidate[], concepts: AnalysisCandidate[], title: string): RelationHint[] {
  if (entities.length === 0 || concepts.length === 0) {
    return []
  }

  const hints: RelationHint[] = []

  for (const entity of entities.slice(0, 3)) {
    for (const concept of concepts.slice(0, 3)) {
      const confidence = Number(((entity.confidence + concept.confidence) / 2).toFixed(2))
      if (confidence < 0.55) {
        continue
      }

      hints.push({
        fromSlug: entity.slug,
        toSlug: concept.slug,
        kind: 'relates-to',
        confidence,
        evidence: `${title} links ${entity.title} and ${concept.title}.`,
      })
    }
  }

  return hints
}

function buildReviewTriggers(
  entities: AnalysisCandidate[],
  concepts: AnalysisCandidate[],
  topics: TopicProposal[],
  options: { sourceMapArtifact?: boolean } = {},
): ReviewTrigger[] {
  const triggers: ReviewTrigger[] = []

  if (options.sourceMapArtifact) {
    triggers.push({
      kind: 'sparse-artifact',
      severity: 'medium',
      reason: 'Source appears to be an index/source-map; review it as navigation context before turning linked targets into durable wiki knowledge.',
    })
  }

  if (!options.sourceMapArtifact && entities.length === 0 && concepts.length === 0) {
    triggers.push({
      kind: 'sparse-artifact',
      severity: 'medium',
      reason: 'No entity or concept candidates reached extraction thresholds.',
    })
  }

  if (topics.length > 0 && hasWeakOrConflictingEvidence(entities, concepts)) {
    triggers.push({
      kind: 'low-confidence',
      severity: 'low',
      reason: 'Topic proposals rely on heuristic or conflicting evidence and should be reviewed.',
    })
  }

  if (hasOverlappingCandidateSlugs(entities, concepts)) {
    triggers.push({
      kind: 'ambiguous-classification',
      severity: 'medium',
      reason: 'The same candidate appeared as both entity and concept.',
    })
  }

  return triggers
}

function isSourceMapArtifact(artifact: NormalizedArtifact, content: string): boolean {
  if (artifact.metadata.sourceRole === 'source-map') {
    return true
  }

  const title = artifact.title.trim().toLowerCase()
  if (!['index', 'contents', 'content', '目录', '索引'].includes(title)) {
    return false
  }

  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) {
    return true
  }
  const navigationLines = lines.filter((line) => /^[-*+]\s+/.test(line) || /^#{1,6}\s+/.test(line) || /\[\[|\]\]|\]\(/.test(line))
  return navigationLines.length / lines.length >= 0.5
}

function computeOverallConfidence(
  entities: AnalysisCandidate[],
  concepts: AnalysisCandidate[],
  topics: TopicProposal[],
): number {
  const values = [...entities.map((candidate) => candidate.confidence), ...concepts.map((candidate) => candidate.confidence), ...topics.map((topic) => topic.confidence)]

  if (values.length === 0) {
    return 0.35
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return Number(average.toFixed(2))
}

function hasMarkerCandidate(candidates: AnalysisCandidate[]): boolean {
  return candidates.some((candidate) => candidate.source === 'marker')
}

function hasStrongStructuredCoverage(entities: AnalysisCandidate[], concepts: AnalysisCandidate[]): boolean {
  return hasMarkerCandidate(entities) && hasMarkerCandidate(concepts)
}

function hasOverlappingCandidateSlugs(entities: AnalysisCandidate[], concepts: AnalysisCandidate[]): boolean {
  return entities.some((entity) => concepts.some((concept) => concept.slug === entity.slug))
}

function hasWeakOrConflictingEvidence(entities: AnalysisCandidate[], concepts: AnalysisCandidate[]): boolean {
  if (entities.length === 0 && concepts.length === 0) {
    return false
  }

  return hasOverlappingCandidateSlugs(entities, concepts) || !hasStrongStructuredCoverage(entities, concepts)
}

function splitMarkerValues(value: string): string[] {
  return value
    .split(/[;,]|\band\b/gi)
    .map((part) => part.replace(/^[-*\s]+/, '').replace(/[.。]+$/g, '').trim())
    .filter(Boolean)
}

function mergeStructuredAndHeuristicCandidates(input: {
  sourceKind: NormalizedArtifact['sourceKind']
  markerCandidates: AnalysisCandidate[]
  heuristicCandidates: AnalysisCandidate[]
}): AnalysisCandidate[] {
  if (input.sourceKind === 'url' && input.markerCandidates.length > 0) {
    return dedupeCandidates(input.markerCandidates)
  }

  return dedupeCandidates([...input.markerCandidates, ...input.heuristicCandidates])
}

function dedupeCandidates(candidates: AnalysisCandidate[]): AnalysisCandidate[] {
  const bySlug = new Map<string, AnalysisCandidate>()

  for (const candidate of candidates) {
    const existing = bySlug.get(candidate.slug)
    if (!existing || candidate.confidence > existing.confidence) {
      bySlug.set(candidate.slug, candidate)
      continue
    }

    const mergedEvidence = [...new Set([...existing.evidence, ...candidate.evidence])]
    bySlug.set(candidate.slug, {
      ...existing,
      evidence: mergedEvidence,
    })
  }

  return [...bySlug.values()]
}

function dedupeTopics(topics: TopicProposal[]): TopicProposal[] {
  const bySlug = new Map<string, TopicProposal>()

  for (const topic of topics) {
    if (!topic.slug) {
      continue
    }

    const existing = bySlug.get(topic.slug)
    if (!existing) {
      bySlug.set(topic.slug, topic)
      continue
    }

    bySlug.set(topic.slug, {
      ...existing,
      confidence: Math.max(existing.confidence, topic.confidence),
      matchedFrom: [...new Set([...existing.matchedFrom, ...topic.matchedFrom])],
    })
  }

  return [...bySlug.values()]
}

function deriveControlledTitlePhrases(title: string): string[] {
  const cleanTitle = normalizeTitleForLabels(title)
  const phraseSet = new Map<string, string>()

  for (const segment of splitTitleSegments(cleanTitle)) {
    addControlledPhrase(phraseSet, segment)

    for (const subSegment of segment.split(/\b(?:for|using|with|to|and|of)\b/gi)) {
      addControlledPhrase(phraseSet, subSegment)
    }

    const forMatch = segment.match(/^(.+?)\s+for\s+(.+)$/i)
    if (forMatch) {
      addControlledPhrase(phraseSet, `${forMatch[1]} for ${forMatch[2]}`)
      addControlledPhrase(phraseSet, forMatch[2] ?? '')
    }
  }

  return [...phraseSet.values()].slice(0, 5)
}

function normalizeTitleForLabels(title: string): string {
  return title
    .replace(/^#+\s*/, '')
    .replace(/\bcomplete official documentation\b/gi, '')
    .replace(/\bofficial documentation\b/gi, '')
    .replace(/\bsaved[_\s-]*date\b.*$/gi, '')
    .replace(/\bsource[_\s-]*url\b.*$/gi, '')
    .replace(/[“”"']/g, '')
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitTitleSegments(title: string): string[] {
  return title
    .split(/\s+(?:[-–—:])\s+|[:：]/g)
    .map((segment) => segment.replace(/\([^)]*\)/g, (match) => ` ${match.slice(1, -1)} `))
    .flatMap((segment) => segment.split(/\s{2,}/g))
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function addControlledPhrase(phraseSet: Map<string, string>, rawPhrase: string): void {
  const phrase = normalizeControlledPhrase(rawPhrase)
  if (!phrase || !isControlledLabel(phrase, { allowSingleTechnicalToken: false })) {
    return
  }

  phraseSet.set(slugify(phrase), phrase)
}

function normalizeControlledPhrase(rawPhrase: string): string {
  const tokens = rawPhrase
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !LABEL_STOP_WORDS.has(token.toLowerCase()))
    .filter((token) => !LABEL_NOISE_WORDS.has(token.toLowerCase()))

  const meaningful = tokens.filter((token) => !GENERIC_ENTITY_WORDS.has(token.toLowerCase()))
  return removeAdjacentRootDuplicates(meaningful).join(' ').trim()
}

function isTaxonomyEligibleCandidate(candidate: AnalysisCandidate): boolean {
  return candidate.source === 'marker'
    || candidate.confidence >= 0.7
    || candidate.evidence.some((evidence) => evidence.startsWith('Title phrase:'))
}

function isControlledLabel(value: string, options: { allowSingleTechnicalToken: boolean }): boolean {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .filter((token) => !LABEL_STOP_WORDS.has(token))
    .filter((token) => !LABEL_NOISE_WORDS.has(token))

  if (tokens.length === 0 || tokens.every((token) => GENERIC_ENTITY_WORDS.has(token))) {
    return false
  }

  if (tokens.length === 1) {
    return options.allowSingleTechnicalToken && tokens[0].length >= 4 && !tokens[0].endsWith('ing')
  }

  if (tokens.length > 4) {
    return false
  }

  return tokens.some((token) => token.length >= 4 && !GENERIC_ENTITY_WORDS.has(token))
}

function removeAdjacentRootDuplicates(tokens: string[]): string[] {
  const result: string[] = []

  for (const token of tokens) {
    const previous = result[result.length - 1]
    if (previous && shareRoot(previous, token)) {
      if (token.length > previous.length) {
        result[result.length - 1] = token
      }
      continue
    }
    result.push(token)
  }

  return result
}

function shareRoot(left: string, right: string): boolean {
  const normalizedLeft = left.toLowerCase().replace(/(?:able|ible|ing|ed|s)$/g, '')
  const normalizedRight = right.toLowerCase().replace(/(?:able|ible|ing|ed|s)$/g, '')
  return normalizedLeft.length >= 4 && normalizedRight.length >= 4
    && (normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft))
}

function stripAnalyzerBoilerplate(value: string): string {
  return value
    .split('\n')
    .filter((line) => !REPO_WRAPPER_LINE_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .join('\n')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function toDisplayTitle(value: string): string {
  return value
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}
