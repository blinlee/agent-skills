import { buildTextWindows, lineRangeForWindow, type LineRange } from './chunking.js'
import { tokenize } from './tokenize.js'

const DEFAULT_FIXED_WINDOW_CHARS = 512
const DEFAULT_FIXED_OVERLAP_CHARS = 64
const DEFAULT_CONTEXT_SENTENCES = 1
const DEFAULT_TOP_K = 3

export type Small2BigEvaluationDocument = {
  id: string
  title: string
  text: string
  baseStartLine?: number
}

export type Small2BigEvaluationQuery = {
  id: string
  question: string
  expectedTerms: string[]
  k?: number
}

export type Small2BigEvaluationInput = {
  documents: Small2BigEvaluationDocument[]
  queries: Small2BigEvaluationQuery[]
  corpusKind?: 'fixture' | 'real'
  citationSchemaAccepted?: boolean
  minimumQueryCountForImplementation?: number
  fixedWindowChars?: number
  fixedOverlapChars?: number
  contextSentences?: number
}

export type Small2BigCandidate = {
  strategy: 'fixed' | 'small2big'
  id: string
  documentId: string
  documentTitle: string
  retrievalText: string
  contextText: string
  retrievalStartOffset: number
  retrievalEndOffset: number
  contextStartOffset: number
  contextEndOffset: number
  retrievalLineRange: LineRange
  contextLineRange: LineRange
  sentenceIndex?: number
}

export type Small2BigQueryEvaluation = {
  queryId: string
  question: string
  expectedTerms: string[]
  k: number
  fixed: Small2BigStrategyEvaluation
  small2big: Small2BigStrategyEvaluation
  delta: {
    recallAtK: number
    readChars: number
    retrievalChars: number
  }
}

export type Small2BigStrategyEvaluation = {
  recallAtK: number
  coveredTerms: string[]
  missingTerms: string[]
  readChars: number
  retrievalChars: number
  citationImpact: {
    averageRetrievalSpanChars: number
    averageContextSpanChars: number
    averageContextExpansionChars: number
    widenedCitations: number
  }
  topCandidates: Array<{
    id: string
    documentId: string
    documentTitle: string
    score: number
    retrievalLineRange: LineRange
    contextLineRange: LineRange
    retrievalChars: number
    contextChars: number
  }>
}

export type Small2BigEvaluationResult = {
  config: {
    fixedWindowChars: number
    fixedOverlapChars: number
    contextSentences: number
    corpusKind: 'fixture' | 'real'
    citationSchemaAccepted: boolean
    minimumQueryCountForImplementation: number
  }
  documentCount: number
  queryCount: number
  candidateCounts: {
    fixed: number
    small2big: number
  }
  queries: Small2BigQueryEvaluation[]
  summary: {
    fixedAverageRecallAtK: number
    small2bigAverageRecallAtK: number
    fixedAverageReadChars: number
    small2bigAverageReadChars: number
    averageContextExpansionChars: number
    recommendation: 'keep-fixed' | 'implement-small2big' | 'needs-real-corpus-evaluation'
    rationale: string[]
  }
}

type ScoredCandidate = Small2BigCandidate & { score: number }

type SentenceSpan = {
  text: string
  startOffset: number
  endOffset: number
}

export function evaluateSmall2BigChunking(input: Small2BigEvaluationInput): Small2BigEvaluationResult {
  const fixedWindowChars = input.fixedWindowChars ?? DEFAULT_FIXED_WINDOW_CHARS
  const fixedOverlapChars = input.fixedOverlapChars ?? DEFAULT_FIXED_OVERLAP_CHARS
  const contextSentences = input.contextSentences ?? DEFAULT_CONTEXT_SENTENCES
  const corpusKind = input.corpusKind ?? 'fixture'
  const citationSchemaAccepted = input.citationSchemaAccepted ?? false
  const minimumQueryCountForImplementation = input.minimumQueryCountForImplementation ?? 5
  const fixedCandidates = input.documents.flatMap((document) => buildFixedCandidates(document, fixedWindowChars, fixedOverlapChars))
  const small2bigCandidates = input.documents.flatMap((document) => buildSmall2BigCandidates(document, contextSentences))

  const queries = input.queries.map((query) => {
    const k = query.k ?? DEFAULT_TOP_K
    const fixed = evaluateStrategy(query, fixedCandidates, k)
    const small2big = evaluateStrategy(query, small2bigCandidates, k)
    return {
      queryId: query.id,
      question: query.question,
      expectedTerms: query.expectedTerms,
      k,
      fixed,
      small2big,
      delta: {
        recallAtK: round(small2big.recallAtK - fixed.recallAtK),
        readChars: small2big.readChars - fixed.readChars,
        retrievalChars: small2big.retrievalChars - fixed.retrievalChars,
      },
    }
  })

  const summary = buildSummary(queries, {
    corpusKind,
    citationSchemaAccepted,
    minimumQueryCountForImplementation,
  })
  return {
    config: {
      fixedWindowChars,
      fixedOverlapChars,
      contextSentences,
      corpusKind,
      citationSchemaAccepted,
      minimumQueryCountForImplementation,
    },
    documentCount: input.documents.length,
    queryCount: input.queries.length,
    candidateCounts: {
      fixed: fixedCandidates.length,
      small2big: small2bigCandidates.length,
    },
    queries,
    summary,
  }
}

export function buildSmall2BigCandidates(document: Small2BigEvaluationDocument, contextSentences = DEFAULT_CONTEXT_SENTENCES): Small2BigCandidate[] {
  const baseStartLine = document.baseStartLine ?? 1
  const sentences = splitSentenceSpans(document.text)
  return sentences.map((sentence, index) => {
    const contextStart = Math.max(0, index - Math.max(0, contextSentences))
    const contextEnd = Math.min(sentences.length - 1, index + Math.max(0, contextSentences))
    const contextStartOffset = sentences[contextStart]!.startOffset
    const contextEndOffset = sentences[contextEnd]!.endOffset
    return {
      strategy: 'small2big',
      id: `${document.id}#sentence-${index + 1}`,
      documentId: document.id,
      documentTitle: document.title,
      retrievalText: sentence.text,
      contextText: document.text.slice(contextStartOffset, contextEndOffset).trim(),
      retrievalStartOffset: sentence.startOffset,
      retrievalEndOffset: sentence.endOffset,
      contextStartOffset,
      contextEndOffset,
      retrievalLineRange: lineRangeForWindow(document.text, baseStartLine, sentence.startOffset, sentence.endOffset),
      contextLineRange: lineRangeForWindow(document.text, baseStartLine, contextStartOffset, contextEndOffset),
      sentenceIndex: index,
    }
  })
}

export function splitSentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  let startOffset = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    const next = text[index + 1]
    if (isSentenceBoundary(char) || (char === '\n' && next === '\n')) {
      const endOffset = isSentenceBoundary(char) ? index + 1 : index
      pushSentenceSpan(spans, text, startOffset, endOffset)
      startOffset = char === '\n' && next === '\n' ? index + 2 : index + 1
      index = startOffset
      continue
    }
    index += 1
  }
  pushSentenceSpan(spans, text, startOffset, text.length)
  return spans
}

function buildFixedCandidates(document: Small2BigEvaluationDocument, windowChars: number, overlapChars: number): Small2BigCandidate[] {
  const baseStartLine = document.baseStartLine ?? 1
  return buildTextWindows(document.text, windowChars, overlapChars).map((window, index) => {
    const lineRange = lineRangeForWindow(document.text, baseStartLine, window.startOffset, window.endOffset)
    return {
      strategy: 'fixed',
      id: `${document.id}#fixed-${index + 1}`,
      documentId: document.id,
      documentTitle: document.title,
      retrievalText: window.text,
      contextText: window.text,
      retrievalStartOffset: window.startOffset,
      retrievalEndOffset: window.endOffset,
      contextStartOffset: window.startOffset,
      contextEndOffset: window.endOffset,
      retrievalLineRange: lineRange,
      contextLineRange: lineRange,
    }
  })
}

function evaluateStrategy(query: Small2BigEvaluationQuery, candidates: Small2BigCandidate[], k: number): Small2BigStrategyEvaluation {
  const topCandidates = rankCandidates(query.question, candidates).slice(0, k)
  const coveredTerms = query.expectedTerms.filter((term) => topCandidates.some((candidate) => termMatches(candidate.contextText, term)))
  const missingTerms = query.expectedTerms.filter((term) => !coveredTerms.includes(term))
  const readChars = topCandidates.reduce((sum, candidate) => sum + candidate.contextText.length, 0)
  const retrievalChars = topCandidates.reduce((sum, candidate) => sum + candidate.retrievalText.length, 0)
  const averageRetrievalSpanChars = average(topCandidates.map((candidate) => candidate.retrievalEndOffset - candidate.retrievalStartOffset))
  const averageContextSpanChars = average(topCandidates.map((candidate) => candidate.contextEndOffset - candidate.contextStartOffset))
  return {
    recallAtK: query.expectedTerms.length === 0 ? 0 : round(coveredTerms.length / query.expectedTerms.length),
    coveredTerms,
    missingTerms,
    readChars,
    retrievalChars,
    citationImpact: {
      averageRetrievalSpanChars: round(averageRetrievalSpanChars),
      averageContextSpanChars: round(averageContextSpanChars),
      averageContextExpansionChars: round(averageContextSpanChars - averageRetrievalSpanChars),
      widenedCitations: topCandidates.filter((candidate) => candidate.contextStartOffset !== candidate.retrievalStartOffset || candidate.contextEndOffset !== candidate.retrievalEndOffset).length,
    },
    topCandidates: topCandidates.map((candidate) => ({
      id: candidate.id,
      documentId: candidate.documentId,
      documentTitle: candidate.documentTitle,
      score: candidate.score,
      retrievalLineRange: candidate.retrievalLineRange,
      contextLineRange: candidate.contextLineRange,
      retrievalChars: candidate.retrievalText.length,
      contextChars: candidate.contextText.length,
    })),
  }
}

function rankCandidates(question: string, candidates: Small2BigCandidate[]): ScoredCandidate[] {
  const queryTokens = tokenize(question)
  return candidates
    .map((candidate) => ({ ...candidate, score: candidateScore(candidate, queryTokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.contextText.length - right.contextText.length || left.id.localeCompare(right.id))
}

function candidateScore(candidate: Small2BigCandidate, queryTokens: string[]): number {
  const retrievalTokens = new Set(tokenize(candidate.retrievalText))
  const contextTokens = new Set(tokenize(candidate.contextText))
  let score = 0
  for (const token of queryTokens) {
    if (retrievalTokens.has(token)) {
      score += 2
    } else if (contextTokens.has(token)) {
      score += 0.5
    }
  }
  return score
}

function buildSummary(
  queries: Small2BigQueryEvaluation[],
  gates: Pick<Small2BigEvaluationResult['config'], 'corpusKind' | 'citationSchemaAccepted' | 'minimumQueryCountForImplementation'>,
): Small2BigEvaluationResult['summary'] {
  const fixedAverageRecallAtK = round(average(queries.map((query) => query.fixed.recallAtK)))
  const small2bigAverageRecallAtK = round(average(queries.map((query) => query.small2big.recallAtK)))
  const fixedAverageReadChars = round(average(queries.map((query) => query.fixed.readChars)))
  const small2bigAverageReadChars = round(average(queries.map((query) => query.small2big.readChars)))
  const averageContextExpansionChars = round(average(queries.map((query) => query.small2big.citationImpact.averageContextExpansionChars)))
  const rationale: string[] = []
  if (small2bigAverageRecallAtK > fixedAverageRecallAtK) {
    rationale.push('Small2Big improved recall@K in the evaluation set.')
  }
  if (small2bigAverageReadChars < fixedAverageReadChars) {
    rationale.push('Small2Big reduced top-K context size, so cited evidence is easier to inspect.')
  }
  if (averageContextExpansionChars > 0) {
    rationale.push('Small2Big requires citation logic to distinguish retrieval sentence spans from expanded context spans.')
  }
  const metricsSupportSmall2Big = small2bigAverageRecallAtK >= fixedAverageRecallAtK
    && small2bigAverageReadChars < fixedAverageReadChars
    && averageContextExpansionChars > 0
  if (small2bigAverageRecallAtK < fixedAverageRecallAtK) {
    rationale.push('Small2Big reduced recall@K in the evaluation set.')
  }
  if (gates.corpusKind !== 'real') {
    rationale.push('Implementation recommendation requires a real knowledge-root corpus, not a fixture.')
  }
  if (queries.length < gates.minimumQueryCountForImplementation) {
    rationale.push(`Implementation recommendation requires at least ${gates.minimumQueryCountForImplementation} evaluation queries.`)
  }
  if (!gates.citationSchemaAccepted) {
    rationale.push('Implementation recommendation requires an accepted citation-schema change because retrieval and context spans differ.')
  }
  const recommendation = !metricsSupportSmall2Big
    ? 'keep-fixed'
    : gates.corpusKind === 'real'
      && queries.length >= gates.minimumQueryCountForImplementation
      && gates.citationSchemaAccepted
      ? 'implement-small2big'
      : 'needs-real-corpus-evaluation'
  if (recommendation === 'needs-real-corpus-evaluation') {
    rationale.push('The current evidence is not strong enough to replace production chunking.')
  }
  return {
    fixedAverageRecallAtK,
    small2bigAverageRecallAtK,
    fixedAverageReadChars,
    small2bigAverageReadChars,
    averageContextExpansionChars,
    recommendation,
    rationale,
  }
}

function pushSentenceSpan(spans: SentenceSpan[], text: string, rawStartOffset: number, rawEndOffset: number): void {
  let startOffset = rawStartOffset
  let endOffset = rawEndOffset
  while (startOffset < endOffset && /\s/.test(text[startOffset]!)) {
    startOffset += 1
  }
  while (endOffset > startOffset && /\s/.test(text[endOffset - 1]!)) {
    endOffset -= 1
  }
  if (startOffset >= endOffset) {
    return
  }
  spans.push({ text: text.slice(startOffset, endOffset), startOffset, endOffset })
}

function termMatches(text: string, term: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerTerm = term.toLowerCase()
  if (lowerText.includes(lowerTerm)) {
    return true
  }
  const tokens = tokenize(term)
  return tokens.length > 0 && tokens.every((token) => tokenize(text).includes(token))
}

function isSentenceBoundary(char: string): boolean {
  return /[.!?。！？]/u.test(char)
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function round(value: number): number {
  return Number(value.toFixed(3))
}
