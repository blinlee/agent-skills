import type { EvidenceBudget } from '../retrieval/context-budget.js'
import { tokenize } from '../retrieval/tokenize.js'
import { buildContradictionTable, HeuristicEvidenceConflictJudge, type EvidenceConflictJudge } from './conflict-judge.js'
import { buildQueryIntent, isStrongSemanticEvidence, type EvidenceForIntent } from './intent.js'
import type {
  QueryCitation,
  QueryGroundedClaim,
  QueryGroundingDiagnostics,
} from './query.js'

export type GroundingSelection = {
  mode: 'matched' | 'overview' | 'no-match'
}

export function buildGroundingDiagnostics(
  question: string,
  selection: GroundingSelection,
  citations: QueryCitation[],
  evidenceBudget: EvidenceBudget,
  lowRetrievalConfidence = false,
  conflictJudge: EvidenceConflictJudge = new HeuristicEvidenceConflictJudge(),
): QueryGroundingDiagnostics {
  const conflicts = conflictJudge.findSignals(citations)
  const claims = buildGroundedClaims(question, citations)
  const contradictionTable = buildContradictionTable(conflicts)
  const hasLexicalQuestionSupport = citationsHaveQuestionSupport(question, citations)
  const hasSemanticQuestionSupport = citationsHaveSemanticQuestionSupport(question, citations)
  const hasGroundedQuestionSupport = hasLexicalQuestionSupport || hasSemanticQuestionSupport
  const allowSemanticConfidenceOverride = hasSemanticQuestionSupport && citationsHaveStrongSemanticQuestionSupport(question, citations)
  return {
    answerability: selection.mode === 'matched' && citations.length > 0 && hasGroundedQuestionSupport && (!lowRetrievalConfidence || allowSemanticConfidenceOverride) ? 'answered' : 'insufficient-evidence',
    evidenceBudget: evidenceBudget.citationLimit,
    selectedCitationCount: citations.length,
    conflictCount: conflicts.length,
    citedChunkIds: citations.map((citation) => citation.chunkId).filter((chunkId): chunkId is string => Boolean(chunkId)),
    claims,
    conflicts,
    contradictionTable,
  }
}

function citationsHaveQuestionSupport(question: string, citations: QueryCitation[]): boolean {
  const stop = new Set([
    'about', 'does', 'what', 'when', 'where', 'which', 'with', 'without', 'from', 'into', 'that', 'this', 'say', 'says', 'said',
    '如何', '什么', '哪些', '为什么', '是否', '关于', '说明', '说',
  ])
  const questionTokens = tokenize(question).filter((token) => token.length >= 3 && !stop.has(token))
  if (questionTokens.length === 0) {
    return citations.length > 0
  }
  return citations.some((citation) => {
    const citationTokens = new Set(tokenize(`${citation.title} ${citation.heading ?? ''} ${citation.excerpt}`))
    return questionTokens.some((token) => citationTokens.has(token))
  })
}

function citationsHaveSemanticQuestionSupport(question: string, citations: QueryCitation[]): boolean {
  const intent = buildQueryIntent(question)
  const rawSemanticCitations = citations.filter((citation) => {
    if (!citation.chunkId || !citation.rawPath || citation.evidenceKind === 'wiki') {
      return false
    }
    const embeddingScore = citation.retrievalScore?.embedding ?? 0
    const rerankScore = citation.retrievalScore?.rerank ?? 0
    const hasSemanticReason = citation.retrievalReasons?.some((reason) =>
      reason.startsWith('embedding:cosine:') || reason === 'coverage:semantic-signal',
    ) ?? false
    return embeddingScore >= 0.25 || rerankScore >= 0.35 || hasSemanticReason
  })
  if (rawSemanticCitations.length === 0) {
    return false
  }

  const multilingualMismatch = containsCjk(question) && rawSemanticCitations.some((citation) =>
    mostlyLatin(`${citation.title} ${citation.heading ?? ''} ${citation.excerpt}`),
  )

  return rawSemanticCitations.some((citation) => isStrongSemanticEvidence({
    intent,
    evidence: citationEvidenceForIntent(citation),
    minEmbeddingWithDomain: multilingualMismatch ? 0.45 : 0.4,
    minEmbeddingWithoutDomain: multilingualMismatch ? 0.62 : 0.55,
  }))
}

function citationsHaveStrongSemanticQuestionSupport(question: string, citations: QueryCitation[]): boolean {
  const intent = buildQueryIntent(question)
  return citations.some((citation) =>
    Boolean(citation.chunkId && citation.rawPath && citation.evidenceKind !== 'wiki')
    && isStrongSemanticEvidence({
      intent,
      evidence: citationEvidenceForIntent(citation),
      minEmbeddingWithDomain: 0.45,
      minEmbeddingWithoutDomain: 0.62,
    }),
  )
}

function citationEvidenceForIntent(citation: QueryCitation): EvidenceForIntent {
  return {
    title: citation.title,
    heading: citation.heading,
    excerpt: citation.excerpt,
    score: citation.retrievalScore,
  }
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value)
}

function mostlyLatin(value: string): boolean {
  const letters = [...value].filter((char) => /\p{Letter}/u.test(char))
  if (letters.length === 0) {
    return false
  }
  const latinLetters = letters.filter((char) => /\p{Script=Latin}/u.test(char))
  return latinLetters.length / letters.length >= 0.6
}

function buildGroundedClaims(question: string, citations: QueryCitation[]): QueryGroundedClaim[] {
  const questionTokens = new Set(tokenize(question))
  const claimsByText = new Map<string, QueryGroundedClaim>()

  citations.forEach((citation, citationIndex) => {
    const sentences = extractSemanticClaimUnits(citation.excerpt)
    const rankedSentences = rankClaimSentences(sentences, questionTokens)
    const bestSentences = rankedSentences.slice(0, 2)

    for (const sentence of bestSentences) {
      const key = normalizeClaimKey(sentence)
      const validation = validateClaimAgainstCitation(sentence, questionTokens, citation)
      const confidence = validation.confidence
      const existing = claimsByText.get(key)
      if (existing) {
        existing.supportingCitations = [...new Set([...existing.supportingCitations, citationIndex + 1])]
        existing.citationIndexes = existing.supportingCitations
        if (citation.chunkId && !existing.chunkIds.includes(citation.chunkId)) {
          existing.chunkIds.push(citation.chunkId)
        }
        existing.confidence = Math.max(existing.confidence, confidence)
        existing.supportLevel = strongestSupportLevel(existing.supportLevel, validation.supportLevel)
        existing.matchedTerms = [...new Set([...existing.matchedTerms, ...validation.matchedTerms])].sort()
        existing.citationCoverage = Math.max(existing.citationCoverage, validation.citationCoverage)
        existing.validation = {
          status: existing.supportLevel === 'weak' ? 'weakly-supported' : 'supported',
          matchedTerms: existing.matchedTerms,
          citationCoverage: existing.citationCoverage,
          supportLevel: existing.supportLevel,
        }
        existing.reason = buildClaimReason(sentence, questionTokens, citation, validation)
        continue
      }

      claimsByText.set(key, {
        text: sentence,
        supportingCitations: [citationIndex + 1],
        citationIndexes: [citationIndex + 1],
        chunkIds: citation.chunkId ? [citation.chunkId] : [],
        confidence,
        reason: buildClaimReason(sentence, questionTokens, citation, validation),
        supportLevel: validation.supportLevel,
        matchedTerms: validation.matchedTerms,
        citationCoverage: validation.citationCoverage,
        validation: {
          status: validation.supportLevel === 'weak' ? 'weakly-supported' : 'supported',
          matchedTerms: validation.matchedTerms,
          citationCoverage: validation.citationCoverage,
          supportLevel: validation.supportLevel,
        },
      })
    }
  })

  return [...claimsByText.values()].slice(0, 6)
}

function extractSemanticClaimUnits(excerpt: string): string[] {
  const seen = new Set<string>()
  const claims: string[] = []
  for (const sentence of splitClaimSentences(excerpt)) {
    const parts = sentence
      .split(/\b(?:however|therefore|because|although|whereas|while)\b|[；;]/iu)
      .map((part) => compact(part))
      .filter((part) => part.length >= 24)
    for (const part of parts.length > 0 ? parts : [sentence]) {
      const key = normalizeClaimKey(part)
      if (!seen.has(key)) {
        seen.add(key)
        claims.push(part)
      }
    }
  }
  return claims
}

function splitClaimSentences(excerpt: string): string[] {
  const normalized = compact(excerpt)
  const parts = normalized
    .split(/(?<=[.!?。！？])\s+|[；;]/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24)

  return parts.length > 0 ? parts : [normalized].filter(Boolean)
}

function rankClaimSentences(sentences: string[], questionTokens: Set<string>): string[] {
  return sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreClaimSentence(sentence, questionTokens),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ sentence }) => sentence)
}

function scoreClaimSentence(sentence: string, questionTokens: Set<string>): number {
  const sentenceTokens = new Set(tokenize(sentence))
  let overlap = 0
  for (const token of questionTokens) {
    if (sentenceTokens.has(token)) {
      overlap += 1
    }
  }
  return overlap * 3 + Math.min(sentenceTokens.size, 20) / 20
}

function validateClaimAgainstCitation(sentence: string, questionTokens: Set<string>, citation: QueryCitation): {
  confidence: number
  matchedTerms: string[]
  citationCoverage: number
  supportLevel: QueryGroundedClaim['supportLevel']
} {
  const claimTokens = meaningfulClaimTokens(sentence)
  const citationTokens = new Set(tokenize(`${citation.title} ${citation.heading ?? ''} ${citation.excerpt}`))
  const matchedTerms = claimTokens.filter((token) => citationTokens.has(token))
  const queryOverlap = [...questionTokens].filter((token) => claimTokens.includes(token)).length
  const citationCoverage = Number((matchedTerms.length / Math.max(1, Math.min(claimTokens.length, 16))).toFixed(2))
  const overlapScore = Math.min(1, queryOverlap / Math.max(1, Math.min(questionTokens.size, 8)))
  const provenanceScore = citation.chunkId ? 0.2 : 0
  const lineSpanScore = citation.startLine && citation.endLine ? 0.1 : 0
  const supportLevel = citationCoverage >= 0.65 && citation.chunkId
    ? 'strong'
    : citationCoverage >= 0.35
      ? 'partial'
      : 'weak'
  const supportScore = supportLevel === 'strong' ? 0.2 : supportLevel === 'partial' ? 0.1 : 0
  return {
    confidence: Number(Math.min(1, 0.35 + overlapScore * 0.2 + provenanceScore + lineSpanScore + supportScore).toFixed(2)),
    matchedTerms: [...new Set(matchedTerms)].sort().slice(0, 10),
    citationCoverage,
    supportLevel,
  }
}

function meaningfulClaimTokens(sentence: string): string[] {
  const stop = new Set(['about', 'also', 'and', 'are', 'because', 'cannot', 'does', 'from', 'have', 'into', 'more', 'that', 'the', 'this', 'with', 'without'])
  return [...new Set(tokenize(sentence).filter((token) => token.length >= 3 && !stop.has(token)))].slice(0, 24)
}

function buildClaimReason(
  sentence: string,
  questionTokens: Set<string>,
  citation: QueryCitation,
  validation: ReturnType<typeof validateClaimAgainstCitation>,
): string {
  const sentenceTokens = new Set(tokenize(sentence))
  const matchedTokens = [...questionTokens].filter((token) => sentenceTokens.has(token)).slice(0, 6)
  const provenance = citation.chunkId ? 'chunk-level citation' : 'page-level citation'
  const span = citation.startLine && citation.endLine ? `lines ${citation.startLine}-${citation.endLine}` : 'no line span'
  return `${provenance}; ${span}; query-token overlap: ${matchedTokens.join(', ') || 'none'}; citation coverage=${validation.citationCoverage}; support=${validation.supportLevel}`
}

function normalizeClaimKey(sentence: string): string {
  return compact(sentence).toLowerCase()
}

function strongestSupportLevel(
  left: QueryGroundedClaim['supportLevel'],
  right: QueryGroundedClaim['supportLevel'],
): QueryGroundedClaim['supportLevel'] {
  const rank = { weak: 0, partial: 1, strong: 2 } as const
  return rank[right] > rank[left] ? right : left
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
