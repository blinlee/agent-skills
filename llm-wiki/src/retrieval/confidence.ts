import type { RetrievalConfidence, RetrievalHit, RetrievalResult } from './types.js'

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.35

export function scoreRetrievalConfidence(mode: RetrievalResult['mode'], hits: RetrievalHit[]): RetrievalConfidence {
  if (hits.length === 0 || mode === 'fallback' || mode === 'no-match' || mode === 'stale-index') {
    return {
      score: 0,
      level: 'none',
      lowConfidence: mode !== 'no-match',
      reasons: [mode === 'fallback' ? 'retrieval-index-unavailable' : mode === 'stale-index' ? 'retrieval-index-stale' : 'no-retrieval-hits'],
    }
  }

  if (mode === 'overview') {
    return {
      score: 0.35,
      level: 'low',
      lowConfidence: true,
      reasons: ['overview-fallback-not-answer-evidence'],
    }
  }

  const topHit = hits[0]!
  const topScore = Math.min(1, Math.max(0, topHit.score.total) / 1.2)
  const hitSupport = Math.min(1, hits.length / 3)
  const signalDiversity = signalDiversityScore(hits)
  const rawEvidenceShare = hits.filter((hit) => hit.chunk.rawPath).length / hits.length
  const coverageStrength = coverageStrengthScore(hits)
  const boilerplatePenalty = hits.some((hit) => hit.reasons.includes('metadata:source-card-boilerplate-penalty')) ? 0.25 : 0
  const embeddingOnlyPenalty = topHit.reasons.includes('diagnostic:embedding-only') ? 0.1 : 0

  const score = clamp01(
    (topScore * 0.35)
    + (hitSupport * 0.15)
    + (signalDiversity * 0.2)
    + (rawEvidenceShare * 0.15)
    + (coverageStrength * 0.15)
    - boilerplatePenalty
    - embeddingOnlyPenalty,
  )
  const rounded = round(score)
  const level = rounded >= 0.75 ? 'high' : rounded >= 0.45 ? 'medium' : 'low'
  const lowConfidenceThreshold = loadRetrievalConfidenceThresholdFromEnv()
  const weakSingleHit = hits.length === 1 && rawEvidenceShare === 0 && signalDiversity < 0.67
  const weakBoilerplateEvidence = boilerplatePenalty > 0 && rawEvidenceShare === 0 && rounded < 0.55
  return {
    score: rounded,
    level,
    lowConfidence: rounded < lowConfidenceThreshold || weakSingleHit || weakBoilerplateEvidence,
    reasons: confidenceReasons({
      topScore,
      hitSupport,
      signalDiversity,
      rawEvidenceShare,
      coverageStrength,
      boilerplatePenalty,
      embeddingOnlyPenalty,
    }),
  }
}

export function loadRetrievalConfidenceThresholdFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = readEnv(env, 'LLM_WIKI_CONFIDENCE_THRESHOLD')
  if (raw === null) {
    return DEFAULT_LOW_CONFIDENCE_THRESHOLD
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid LLM_WIKI_CONFIDENCE_THRESHOLD: ${raw}. Must be a number between 0 and 1.`)
  }
  return parsed
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const upper = env[name]
  const lower = env[name.toLowerCase()]
  const value = upper && upper.trim().length > 0 ? upper : lower
  return value && value.trim().length > 0 ? value.trim() : null
}

function signalDiversityScore(hits: RetrievalHit[]): number {
  const signals = new Set<string>()
  for (const hit of hits) {
    if (hit.score.lexical > 0) signals.add('lexical')
    if (hit.score.embedding > 0) signals.add('embedding')
    if (hit.score.graph > 0) signals.add('graph')
    if (hit.score.taxonomy > 0) signals.add('taxonomy')
    if (hit.score.metadata > 0) signals.add('metadata')
    if (hit.score.rerank > 0) signals.add('rerank')
  }
  return Math.min(1, signals.size / 3)
}

function coverageStrengthScore(hits: RetrievalHit[]): number {
  if (hits.some((hit) => hit.reasons.includes('coverage:semantic-signal'))) return 1
  if (hits.some((hit) => hit.reasons.includes('coverage:lexical-coverage'))) return 0.85
  if (hits.some((hit) => hit.reasons.includes('coverage:short-query'))) return 0.45
  return 0
}

function confidenceReasons(input: {
  topScore: number
  hitSupport: number
  signalDiversity: number
  rawEvidenceShare: number
  coverageStrength: number
  boilerplatePenalty: number
  embeddingOnlyPenalty: number
}): string[] {
  const reasons: string[] = []
  if (input.topScore >= 0.7) reasons.push('strong-top-score')
  if (input.hitSupport >= 0.67) reasons.push('multiple-supporting-hits')
  if (input.signalDiversity >= 0.67) reasons.push('multi-signal-retrieval')
  if (input.rawEvidenceShare >= 0.5) reasons.push('raw-evidence-backed')
  if (input.coverageStrength >= 0.85) reasons.push('query-coverage-supported')
  if (input.boilerplatePenalty > 0) reasons.push('boilerplate-penalty')
  if (input.embeddingOnlyPenalty > 0) reasons.push('embedding-only-penalty')
  if (reasons.length === 0) reasons.push('weak-retrieval-signals')
  return reasons
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function round(value: number): number {
  return Number(value.toFixed(3))
}
