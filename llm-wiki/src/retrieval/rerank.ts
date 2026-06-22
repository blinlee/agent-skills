import type { HybridScoreEntry } from './hybrid.js'

export type RerankConfig = {
  endpoint: string
  model: string | null
  timeoutMs: number
  topN: number
}

export type RerankCandidate = {
  chunkId: string
  text: string
}

export type Reranker = {
  rerank(input: {
    question: string
    candidates: RerankCandidate[]
    config: RerankConfig
  }): Promise<Map<string, number>>
}

export type RerankedHybridScoreEntry = HybridScoreEntry & {
  rerank: number
}

const DEFAULT_RERANK_TIMEOUT_MS = 30_000
const DEFAULT_RERANK_TOP_N = 20
const RERANK_WEIGHT = 0.5

export function loadRerankConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RerankConfig | null {
  const endpoint = readEnv(env, 'LLM_WIKI_RERANK_ENDPOINT')
  if (!endpoint) {
    return null
  }
  const timeoutMs = parsePositiveInteger(readEnv(env, 'LLM_WIKI_RERANK_TIMEOUT_MS'), DEFAULT_RERANK_TIMEOUT_MS, 'LLM_WIKI_RERANK_TIMEOUT_MS')
  const topN = parsePositiveInteger(readEnv(env, 'LLM_WIKI_RERANK_TOP_N'), DEFAULT_RERANK_TOP_N, 'LLM_WIKI_RERANK_TOP_N')
  return {
    endpoint,
    model: readEnv(env, 'LLM_WIKI_RERANK_MODEL'),
    timeoutMs,
    topN,
  }
}

export async function rerankHybridEntries(input: {
  question: string
  entries: HybridScoreEntry[]
  limit: number
  diagnostics: string[]
  config?: RerankConfig | null
  reranker?: Reranker
}): Promise<RerankedHybridScoreEntry[]> {
  const config = input.config === undefined ? loadRerankConfigFromEnv() : input.config
  const baseEntries = input.entries.map(withoutRerank)
  if (!config || baseEntries.length === 0) {
    return baseEntries
  }

  const candidateCount = Math.min(Math.max(input.limit, 1), config.topN, baseEntries.length)
  const candidates = baseEntries.slice(0, candidateCount)
  const passthrough = baseEntries.slice(candidateCount)
  const reranker = input.reranker ?? new LocalHttpReranker()

  try {
    const scores = await reranker.rerank({
      question: input.question,
      candidates: candidates.map((entry) => ({ chunkId: entry.chunk.chunkId, text: entry.chunk.text })),
      config,
    })
    if (scores.size === 0) {
      input.diagnostics.push('rerank endpoint returned no usable scores; using hybrid order')
      return baseEntries
    }
    const reranked = candidates
      .map((entry, index) => withRerankScore(entry, scores.get(entry.chunk.chunkId), index))
      .sort((left, right) => right.rerank - left.rerank
        || right.total - left.total
        || left.chunk.chunkId.localeCompare(right.chunk.chunkId))
    input.diagnostics.push(`rerank applied to top ${candidateCount} candidate(s)`)
    return [...reranked, ...passthrough]
  } catch (error) {
    input.diagnostics.push(`rerank unavailable; using hybrid order: ${(error as Error).message}`)
    return baseEntries
  }
}

export class LocalHttpReranker implements Reranker {
  async rerank(input: {
    question: string
    candidates: RerankCandidate[]
    config: RerankConfig
  }): Promise<Map<string, number>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs)
    try {
      const response = await fetch(input.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.config.model ?? undefined,
          query: input.question,
          documents: input.candidates.map((candidate) => candidate.text),
          pairs: input.candidates.map((candidate) => [input.question, candidate.text]),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const body = await response.json() as unknown
      return parseRerankResponse(body, input.candidates)
    } finally {
      clearTimeout(timeout)
    }
  }
}

function withRerankScore(entry: RerankedHybridScoreEntry, score: number | undefined, index: number): RerankedHybridScoreEntry {
  if (score === undefined || !Number.isFinite(score)) {
    return {
      ...entry,
      reasons: [...entry.reasons, `rerank:missing:${index}`],
    }
  }
  const rerank = round(normalizeScore(score))
  return {
    ...entry,
    rerank,
    total: round(entry.total + (rerank * RERANK_WEIGHT)),
    reasons: [...entry.reasons, `rerank:score:${rerank.toFixed(3)}`],
  }
}

function withoutRerank(entry: HybridScoreEntry): RerankedHybridScoreEntry {
  return { ...entry, rerank: 0 }
}

function parseRerankResponse(body: unknown, candidates: RerankCandidate[]): Map<string, number> {
  const scores = new Map<string, number>()
  if (isRecord(body)) {
    collectScoreArray(scores, body.scores, candidates)
    collectScoreObjects(scores, body.results, candidates)
    collectScoreObjects(scores, body.data, candidates)
  }
  return scores
}

function collectScoreArray(scores: Map<string, number>, value: unknown, candidates: RerankCandidate[]): void {
  if (!Array.isArray(value)) {
    return
  }
  value.forEach((item, index) => {
    if (typeof item === 'number' && Number.isFinite(item)) {
      const candidate = candidates[index]
      if (candidate) {
        scores.set(candidate.chunkId, item)
      }
      return
    }
    if (isRecord(item)) {
      collectScoreObject(scores, item, candidates)
    }
  })
}

function collectScoreObjects(scores: Map<string, number>, value: unknown, candidates: RerankCandidate[]): void {
  if (!Array.isArray(value)) {
    return
  }
  for (const item of value) {
    if (isRecord(item)) {
      collectScoreObject(scores, item, candidates)
    }
  }
}

function collectScoreObject(scores: Map<string, number>, value: Record<string, unknown>, candidates: RerankCandidate[]): void {
  const index = numericField(value, 'index') ?? numericField(value, 'document_index') ?? numericField(value, 'documentIndex')
  const score = numericField(value, 'score') ?? numericField(value, 'relevance_score') ?? numericField(value, 'relevanceScore')
  if (index === null || score === null) {
    return
  }
  const candidate = candidates[index]
  if (candidate) {
    scores.set(candidate.chunkId, score)
  }
}

function numericField(value: Record<string, unknown>, key: string): number | null {
  const item = value[key]
  return typeof item === 'number' && Number.isFinite(item) ? item : null
}

function normalizeScore(value: number): number {
  if (value >= 0 && value <= 1) {
    return value
  }
  return 1 / (1 + Math.exp(-value))
}

function parsePositiveInteger(value: string | null, fallback: number, name: string): number {
  if (!value) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`)
  }
  return parsed
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const upper = env[name]
  const lower = env[name.toLowerCase()]
  const value = upper && upper.trim().length > 0 ? upper : lower
  return value && value.trim().length > 0 ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function round(value: number): number {
  return Number(value.toFixed(6))
}
