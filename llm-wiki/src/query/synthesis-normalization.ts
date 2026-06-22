import type { StoredSynthesisSuggestion } from './query.js'

export type RawStoredSynthesisSuggestion = {
  id?: unknown
  type?: unknown
  status?: unknown
  question?: unknown
  title?: unknown
  slug?: unknown
  answer?: unknown
  citations?: unknown
  grounding?: unknown
  relatedPages?: unknown
  markdown?: unknown
  body?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  reviewedAt?: unknown
  reviewer?: unknown
  promotedAt?: unknown
  pagePath?: unknown
}

const SAFE_SYNTHESIS_SLUG_PATTERN = /^[a-z0-9-]+$/

export function normalizeStoredSuggestion(raw: RawStoredSynthesisSuggestion): StoredSynthesisSuggestion {
  const now = new Date().toISOString()
  const id = typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : null
  const title = typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title : null
  const slug = typeof raw.slug === 'string' && raw.slug.trim().length > 0 ? raw.slug : null
  const markdown = typeof raw.markdown === 'string' && raw.markdown.trim().length > 0
    ? ensureTrailingNewline(raw.markdown)
    : typeof raw.body === 'string' && raw.body.trim().length > 0
      ? ensureTrailingNewline(raw.body)
      : null

  if (!id || !title || !slug || !markdown) {
    throw new Error(`Synthesis suggestion is not in a promotable format: required fields are missing for suggestion ${String(raw.id ?? 'unknown')}.`)
  }

  validateSynthesisSlug(slug)

  const citations = Array.isArray(raw.citations)
    ? raw.citations.filter(isQueryCitation)
    : []
  const relatedPages = Array.isArray(raw.relatedPages)
    ? raw.relatedPages.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []
  const grounding = normalizeGrounding(raw.grounding, id)

  return {
    id,
    type: raw.type === 'synthesis-suggestion' || raw.type === 'merge-candidate' ? raw.type : 'merge-candidate',
    status: raw.status === 'reviewed' || raw.status === 'promoted' ? raw.status : 'suggested',
    question: typeof raw.question === 'string' && raw.question.trim().length > 0
      ? raw.question
      : `Promote ingest-generated synthesis suggestion “${title}”.`,
    title,
    slug,
    answer: typeof raw.answer === 'string' && raw.answer.trim().length > 0
      ? raw.answer
      : compactMarkdown(markdown),
    citations,
    relatedPages,
    grounding,
    markdown,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim().length > 0 ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim().length > 0 ? raw.updatedAt : now,
    reviewedAt: typeof raw.reviewedAt === 'string' ? raw.reviewedAt : undefined,
    reviewer: typeof raw.reviewer === 'string' ? raw.reviewer : undefined,
    promotedAt: typeof raw.promotedAt === 'string' ? raw.promotedAt : undefined,
    pagePath: typeof raw.pagePath === 'string' ? raw.pagePath : undefined,
  }
}

function normalizeGrounding(value: unknown, suggestionId: string): NonNullable<StoredSynthesisSuggestion['grounding']> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Synthesis suggestion ${suggestionId} is missing grounding metadata and cannot be promoted.`)
  }
  const candidate = value as Record<string, unknown>
  const answerability = candidate.answerability === 'answered' || candidate.answerability === 'insufficient-evidence'
    ? candidate.answerability
    : 'insufficient-evidence'
  const citedChunkIds = Array.isArray(candidate.citedChunkIds)
    ? candidate.citedChunkIds.filter((item): item is string => typeof item === 'string')
    : []
  return {
    answerability,
    evidenceBudget: typeof candidate.evidenceBudget === 'number' ? candidate.evidenceBudget : 0,
    selectedCitationCount: typeof candidate.selectedCitationCount === 'number' ? candidate.selectedCitationCount : 0,
    conflictCount: typeof candidate.conflictCount === 'number' ? candidate.conflictCount : 0,
    citedChunkIds,
    claims: normalizeGroundingClaims(candidate.claims),
    conflicts: normalizeGroundingConflicts(candidate.conflicts),
    contradictionTable: normalizeContradictionTable(candidate.contradictionTable),
  }
}

function normalizeGroundingClaims(value: unknown): StoredSynthesisSuggestion['grounding'] extends infer G ? G extends { claims: infer C } ? C : never : never {
  if (!Array.isArray(value)) return [] as never
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      text: typeof item.text === 'string' ? item.text : '',
      supportingCitations: Array.isArray(item.supportingCitations) ? item.supportingCitations.filter((index): index is number => typeof index === 'number') : [],
      citationIndexes: Array.isArray(item.citationIndexes) ? item.citationIndexes.filter((index): index is number => typeof index === 'number') : [],
      chunkIds: Array.isArray(item.chunkIds) ? item.chunkIds.filter((chunkId): chunkId is string => typeof chunkId === 'string') : [],
      confidence: typeof item.confidence === 'number' ? item.confidence : 0,
      reason: typeof item.reason === 'string' ? item.reason : 'unknown',
      supportLevel: item.supportLevel === 'strong' || item.supportLevel === 'partial' || item.supportLevel === 'weak' ? item.supportLevel : 'weak',
      matchedTerms: Array.isArray(item.matchedTerms) ? item.matchedTerms.filter((term): term is string => typeof term === 'string') : [],
      citationCoverage: typeof item.citationCoverage === 'number' ? item.citationCoverage : 0,
      validation: normalizeClaimValidation(item.validation, item),
    })) as never
}

function normalizeGroundingConflicts(value: unknown): StoredSynthesisSuggestion['grounding'] extends infer G ? G extends { conflicts: infer C } ? C : never : never {
  if (!Array.isArray(value)) return [] as never
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      citationIndex: typeof item.citationIndex === 'number' ? item.citationIndex : 0,
      target: typeof item.target === 'string' ? item.target : '',
      chunkId: typeof item.chunkId === 'string' ? item.chunkId : undefined,
      kind: item.kind === 'conflict' || item.kind === 'stale' || item.kind === 'uncertain' || item.kind === 'contradictory' ? item.kind : 'conflict',
      severity: item.severity === 'high' || item.severity === 'medium' || item.severity === 'low' ? item.severity : 'medium',
      reason: typeof item.reason === 'string' ? item.reason : 'unknown',
      matchedText: typeof item.matchedText === 'string' ? item.matchedText : '',
      excerpt: typeof item.excerpt === 'string' ? item.excerpt : '',
      evidencePair: normalizeEvidencePair(item.evidencePair),
      evidence: normalizeConflictEvidenceList(item.evidence),
      targets: Array.isArray(item.targets) ? item.targets.filter((target): target is string => typeof target === 'string') : [],
      chunkIds: Array.isArray(item.chunkIds) ? item.chunkIds.filter((chunkId): chunkId is string => typeof chunkId === 'string') : [],
    })) as never
}

function normalizeClaimValidation(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : fallback
  const supportLevel = record.supportLevel === 'strong' || record.supportLevel === 'partial' || record.supportLevel === 'weak' ? record.supportLevel : 'weak'
  return {
    status: supportLevel === 'weak' ? 'weakly-supported' : 'supported',
    matchedTerms: Array.isArray(record.matchedTerms) ? record.matchedTerms.filter((term): term is string => typeof term === 'string') : [],
    citationCoverage: typeof record.citationCoverage === 'number' ? record.citationCoverage : 0,
    supportLevel,
  }
}

function normalizeContradictionTable(value: unknown): StoredSynthesisSuggestion['grounding'] extends infer G ? G extends { contradictionTable: infer C } ? C : never : never {
  if (!Array.isArray(value)) return [] as never
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      issueId: typeof item.issueId === 'string' ? item.issueId : '',
      kind: item.kind === 'conflict' || item.kind === 'stale' || item.kind === 'uncertain' || item.kind === 'contradictory' ? item.kind : 'conflict',
      severity: item.severity === 'high' || item.severity === 'medium' || item.severity === 'low' ? item.severity : 'medium',
      summary: typeof item.summary === 'string' ? item.summary : '',
      evidence: normalizeConflictEvidenceList(item.evidence),
      targets: Array.isArray(item.targets) ? item.targets.filter((target): target is string => typeof target === 'string') : [],
      chunkIds: Array.isArray(item.chunkIds) ? item.chunkIds.filter((chunkId): chunkId is string => typeof chunkId === 'string') : [],
      freshness: item.freshness === 'stale-signal' || item.freshness === 'current-conflict' || item.freshness === 'unknown' ? item.freshness : 'unknown',
      recommendation: typeof item.recommendation === 'string' ? item.recommendation : '',
    })) as never
}

function normalizeEvidencePair(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .slice(0, 2)
    .map(normalizeConflictEvidence)
    .filter((entry): entry is NonNullable<ReturnType<typeof normalizeConflictEvidence>> => entry !== null)
}

function normalizeConflictEvidenceList(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map(normalizeConflictEvidence)
    .filter((entry): entry is NonNullable<ReturnType<typeof normalizeConflictEvidence>> => entry !== null)
}

function normalizeConflictEvidence(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const item = value as Record<string, unknown>
  return {
    citationIndex: typeof item.citationIndex === 'number' ? item.citationIndex : 0,
    target: typeof item.target === 'string' ? item.target : '',
    chunkId: typeof item.chunkId === 'string' ? item.chunkId : undefined,
    excerpt: typeof item.excerpt === 'string' ? item.excerpt : '',
    matchedText: typeof item.matchedText === 'string' ? item.matchedText : undefined,
  }
}

function validateSynthesisSlug(slug: string): void {
  if (!SAFE_SYNTHESIS_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid synthesis slug: ${slug}`)
  }
}

function isQueryCitation(value: unknown): value is StoredSynthesisSuggestion['citations'][number] {
  return typeof value === 'object' && value !== null
    && typeof (value as { target?: unknown }).target === 'string'
    && typeof (value as { title?: unknown }).title === 'string'
    && typeof (value as { filePath?: unknown }).filePath === 'string'
    && typeof (value as { excerpt?: unknown }).excerpt === 'string'
}

function compactMarkdown(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`
}
