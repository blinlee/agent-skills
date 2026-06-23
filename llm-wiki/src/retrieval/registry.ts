import { createSensitiveRedactor, runQuery, type QueryAgentReadingPack, type QueryCitation, type QueryCommandResult, type QuerySourceReadingPack } from '../query/query.js'
import { buildQueryIntent, isEmbeddingOnlyScore, isEvidenceDomainConsistent, isFocusedEvidenceForIntent, isMeaningfulNonEmbeddingSupport, isStrongSemanticEvidence, scoreEvidenceIntentFit, type EvidenceForIntent, type QueryIntent, type QueryIntentProfile, type QueryReadingMode } from '../query/intent.js'
import { buildKnowledgeQueryReadiness, type KnowledgeQueryReadinessReport } from './readiness.js'
import { buildRegistryDiagnostics } from './registry-diagnostics.js'
import { buildRegistrySourceReadingPack, registryCitationKey, registryPassagesByCitation } from './registry-source-pack.js'
import { loadRerankConfigFromEnv, LocalHttpReranker, type RerankConfig, type Reranker } from './rerank.js'
import { retrieveChunks } from './retrieval.js'
import type { RetrievalHit, RetrievalScore, RetrievalSignalSummary } from './types.js'

export type RegistryRetrievalWiki = {
  wikiId: string
  title: string
  knowledgeRoot: string
  score: number
  matchedTerms: string[]
  scopeCore?: string[]
  scopeAdjacent?: string[]
  scope?: string[]
  outOfScope?: string[]
  aliases?: string[]
}

export type QueryRegistryCitation = QueryCitation & {
  wikiId: string
  wikiTitle: string
  knowledgeRoot: string
  score: RetrievalScore
  reasons: string[]
}

export type QueryRegistryWikiResult = RegistryRetrievalWiki & {
  chunkScore: number
  calibratedScore: number
  durationMs: number
  citationPack: QueryRegistryCitation[]
  retrievalSignals: RetrievalSignalSummary | null
  retrievalDiagnostics: string[]
  readiness: KnowledgeQueryReadinessReport | null
  result: QueryCommandResult | null
  error: string | null
}

export type QueryRegistryAgentReadingPack = {
  answerability: 'answered' | 'insufficient-evidence'
  retrievalMode: 'registry-hybrid'
  embeddingUsed: boolean
  citationCount: number
  mustReadFurther: boolean
  searchedWikis: Array<Pick<QueryRegistryWikiResult, 'wikiId' | 'title' | 'knowledgeRoot' | 'chunkScore'>>
  citationsToRead: Array<{
    citationIndex: number
    wikiId: string
    wikiTitle: string
    target: string
    title: string
    filePath: string
    heading?: string
    startLine?: number
    endLine?: number
    sourceRef?: string | null
    rawPath?: string | null
    artifactId?: string | null
    evidenceKind?: 'raw' | 'wiki'
    chunkId?: string
  }>
  diagnostics: QueryRegistryDiagnostics
  perWikiReadingPacks: Array<{ wikiId: string; agentReadingPack: QueryAgentReadingPack | null }>
}

export type QueryRegistrySourceDocument = {
  documentIndex: number
  wikiId: string
  wikiTitle: string
  sourceTitle: string
  sourceRef?: string | null
  rawPath?: string | null
  filePath: string
  evidenceKind?: 'raw' | 'wiki'
  selectedPassageIndexes: number[]
}

export type QueryRegistrySourceReadingPack = QuerySourceReadingPack & {
  readingMode: 'passage' | 'document'
  documentCount?: number
  documents?: QueryRegistrySourceDocument[]
  passages: Array<QuerySourceReadingPack['passages'][number] & {
    wikiId: string
    wikiTitle: string
  }>
}

export type QueryRegistryDiagnostics = {
  fusionPolicy: 'selectedCitationRank asc -> calibratedScore desc -> chunkScore desc -> profile score desc -> topEmbedding desc -> wikiId asc'
  selectedWikiCount: number
  resultWikiCount: number
  errorCount: number
  citationCountBeforeDedupe: number
  citationCountAfterDedupe: number
  rawBackedCitationCountBeforeDedupe: number
  derivedCitationCountBeforeDedupe: number
  rawBackedCitationCountAfterDedupe: number
  derivedCitationCountAfterDedupe: number
  citationBudget: number
  maxCitationsPerWiki: number
  maxConcurrentWikis: number
  registryRerankDiagnostics: string[]
  embeddingDegradedWikis: Array<{ wikiId: string; diagnostics: string[] }>
  readiness: {
    status: 'ready' | 'partial' | 'blocked'
    wikis: Array<{
      wikiId: string
      status: KnowledgeQueryReadinessReport['status']
      indexStatus: KnowledgeQueryReadinessReport['index']['status']
      embeddingStatus: KnowledgeQueryReadinessReport['embedding']['status']
      currentChunkCount: number
      reusableVectorCount: number
      missingVectorCount: number
    }>
  }
  errors: Array<{ wikiId: string; error: string }>
  averageDurationMs: number
  perWikiMetrics: Array<{
    wikiId: string
    status: 'answered' | 'insufficient-evidence' | 'no-match' | 'stale-index' | 'embedding-degraded' | 'error'
    durationMs: number
    profileScore: number
    chunkScore: number
    calibratedScore: number
    citationCount: number
    error: string | null
  }>
}

export type QueryRegistryResult = {
  question: string
  answer: string
  selectedWikis: Array<Pick<QueryRegistryWikiResult, 'wikiId' | 'title' | 'knowledgeRoot' | 'score' | 'matchedTerms' | 'chunkScore' | 'calibratedScore'>>
  citations: QueryRegistryCitation[]
  diagnostics: QueryRegistryDiagnostics
  sourceReadingPack: QueryRegistrySourceReadingPack
  agentReadingPack: QueryRegistryAgentReadingPack
  results: QueryRegistryWikiResult[]
}

export async function runRegistryHybridRetrieval(input: {
  question: string
  selectedWikis: RegistryRetrievalWiki[]
  citationBudget?: number
  maxCitationsPerWiki?: number
  maxConcurrentWikis?: number
  rerankConfig?: RerankConfig | null
  reranker?: Reranker
  queryIntent?: QueryIntent
  readingMode?: QueryReadingMode
}): Promise<Omit<QueryRegistryResult, 'question'>> {
  const citationBudget = Math.max(1, input.citationBudget ?? 8)
  const maxCitationsPerWiki = Math.max(1, input.maxCitationsPerWiki ?? 3)
  const maxConcurrentWikis = Math.max(1, input.maxConcurrentWikis ?? 4)
  const redactor = createSensitiveRedactor(input.question)
  const displayQuestion = redactor(input.question)
  const queryIntent = input.queryIntent ?? buildQueryIntent(input.question, queryIntentProfilesForWikis(input.selectedWikis), { readingMode: input.readingMode })
  const readingMode: QueryRegistrySourceReadingPack['readingMode'] = input.readingMode ?? (queryIntent.prefersDocumentReading ? 'document' : 'passage')
  const results = await mapWithConcurrency(input.selectedWikis, maxConcurrentWikis, async (wiki) =>
    queryRegistryWiki(input.question, wiki, redactor, { limit: retrievalLimitForIntent(queryIntent), queryIntent }))

  results.sort(compareRegistryResults)
  const allCitations = results.flatMap((entry) => entry.citationPack)
  const passagesByCitation = registryPassagesByCitation(results)
  const registryRerankDiagnostics: string[] = []
  const rankedCitations = await rerankRegistryCitations({
    question: input.question,
    citations: allCitations,
    queryIntent,
    passagesByCitation,
    citationBudget,
    diagnostics: registryRerankDiagnostics,
    config: input.rerankConfig,
    reranker: input.reranker,
  })
  const answerableWikiIds = new Set(results
    .filter((entry) => entry.result?.grounding.answerability === 'answered')
    .map((entry) => entry.wikiId))
  const citations = readingMode === 'document'
    ? selectSurveyRegistryCitations(rankedCitations, queryIntent, results, { citationBudget, maxCitationsPerWiki })
    : selectDefaultRegistryCitations(rankedCitations, queryIntent, results, { citationBudget, maxCitationsPerWiki })
  const answerability = citations.some((citation) => isRegistryAnswerEvidence(citation, answerableWikiIds)) ? 'answered' : 'insufficient-evidence'
  const outputResults = orderRegistryResultsForOutput(results, citations)
  const diagnostics = buildRegistryDiagnostics({
    selectedWikiCount: input.selectedWikis.length,
    results: outputResults,
    citationCountBeforeDedupe: allCitations.length,
    citationCountAfterDedupe: citations.length,
    selectedCitations: citations,
    citationBudget,
    maxCitationsPerWiki,
    maxConcurrentWikis,
    registryRerankDiagnostics,
  })
  const selectedWikis = outputResults.map(({ wikiId, title, knowledgeRoot, score, matchedTerms, chunkScore, calibratedScore }) => ({
    wikiId,
    title,
    knowledgeRoot,
    score,
    matchedTerms,
    chunkScore,
    calibratedScore,
  }))
  return {
    answer: redactor(buildRegistryAnswer(displayQuestion, outputResults, citations, answerability)),
    selectedWikis,
    citations,
    diagnostics,
    sourceReadingPack: buildRegistrySourceReadingPack(answerability, citations, outputResults, passagesByCitation, readingMode),
    agentReadingPack: buildRegistryAgentReadingPack({ results: outputResults, selectedWikis, citations, diagnostics, answerability }),
    results: outputResults,
  }
}

async function queryRegistryWiki(
  question: string,
  wiki: RegistryRetrievalWiki,
  redactor: (text: string) => string,
  options: { limit?: number; queryIntent?: QueryIntent } = {},
): Promise<QueryRegistryWikiResult> {
  const started = Date.now()
  try {
    const readiness = await buildKnowledgeQueryReadiness({ knowledgeRoot: wiki.knowledgeRoot })
    const retrieval = await retrieveChunks({ knowledgeRoot: wiki.knowledgeRoot, question, limit: options.limit })
    const result = await runQuery({ knowledgeRoot: wiki.knowledgeRoot, question, retrieval, queryIntent: options.queryIntent })
    const citationPack = buildRegistryCitationPack(wiki, retrieval.hits, redactor)
    const chunkScore = citationPack[0]?.score.total ?? 0
    return {
      ...wiki,
      chunkScore,
      calibratedScore: calibratedRegistryScore(chunkScore, wiki.score),
      durationMs: Date.now() - started,
      citationPack,
      retrievalSignals: retrieval.signalSummary,
      retrievalDiagnostics: retrieval.diagnostics,
      readiness,
      result,
      error: null,
    }
  } catch (error) {
    return {
      ...wiki,
      chunkScore: 0,
      calibratedScore: calibratedRegistryScore(0, wiki.score),
      durationMs: Date.now() - started,
      citationPack: [],
      retrievalSignals: null,
      retrievalDiagnostics: [],
      readiness: null,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function calibratedRegistryScore(chunkScore: number, profileScore: number): number {
  const boundedProfileScore = Math.max(0, Math.min(1, profileScore))
  return Number((chunkScore + boundedProfileScore * 0.05).toFixed(6))
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

function buildRegistryCitationPack(
  wiki: Pick<RegistryRetrievalWiki, 'wikiId' | 'title' | 'knowledgeRoot'>,
  hits: RetrievalHit[],
  redactor: (text: string) => string,
): QueryRegistryCitation[] {
  return hits.map((hit) => ({
    target: hit.citation.pageTarget,
    title: redactor(hit.citation.pageTitle),
    filePath: hit.citation.filePath,
    excerpt: redactor(hit.citation.excerpt),
    chunkId: hit.citation.chunkId,
    pageTarget: hit.citation.pageTarget,
    heading: hit.citation.heading ? redactor(hit.citation.heading) : hit.citation.heading,
    headingPath: hit.citation.headingPath?.map((heading) => redactor(heading)),
    startLine: hit.citation.startLine,
    endLine: hit.citation.endLine,
    sourceRef: hit.citation.sourceRef,
    rawPath: hit.citation.rawPath ?? null,
    artifactId: hit.citation.artifactId ?? null,
    evidenceKind: hit.citation.evidenceKind ?? (hit.citation.rawPath ? 'raw' : 'wiki'),
    wikiId: wiki.wikiId,
    wikiTitle: wiki.title,
    knowledgeRoot: wiki.knowledgeRoot,
    score: hit.score,
    reasons: hit.reasons,
  }))
}

function compareRegistryResults(left: QueryRegistryWikiResult, right: QueryRegistryWikiResult): number {
  return right.calibratedScore - left.calibratedScore
    || right.chunkScore - left.chunkScore
    || right.score - left.score
    || topRegistryEmbeddingScore(right) - topRegistryEmbeddingScore(left)
    || left.wikiId.localeCompare(right.wikiId)
}

function topRegistryEmbeddingScore(result: QueryRegistryWikiResult): number {
  return Math.max(0, ...result.citationPack.map((citation) => citation.score.embedding))
}

function orderRegistryResultsForOutput(results: QueryRegistryWikiResult[], citations: QueryRegistryCitation[]): QueryRegistryWikiResult[] {
  const firstCitationRank = new Map<string, number>()
  citations.forEach((citation, index) => {
    if (!firstCitationRank.has(citation.wikiId)) {
      firstCitationRank.set(citation.wikiId, index)
    }
  })
  return [...results].sort((left, right) => {
    const leftRank = firstCitationRank.get(left.wikiId) ?? Number.POSITIVE_INFINITY
    const rightRank = firstCitationRank.get(right.wikiId) ?? Number.POSITIVE_INFINITY
    return leftRank - rightRank || compareRegistryResults(left, right)
  })
}

function diversifyRegistryCitations(
  citations: QueryRegistryCitation[],
  queryIntent: QueryIntent,
  options: { citationBudget?: number; maxCitationsPerWiki?: number } = {},
): QueryRegistryCitation[] {
  const citationBudget = options.citationBudget ?? 8
  const maxCitationsPerWiki = options.maxCitationsPerWiki ?? 3
  const seen = new Set<string>()
  const wikiCounts = new Map<string, number>()
  const diversified: QueryRegistryCitation[] = []
  const sorted = [...citations].sort((left, right) => compareRegistryCitations(left, right, queryIntent))

  for (const citation of sorted) {
    if (diversified.length >= citationBudget) break
    const wikiCount = wikiCounts.get(citation.wikiId) ?? 0
    if (wikiCount >= maxCitationsPerWiki) continue
    const key = citation.sourceRef
      ? `source:${citation.sourceRef}:${citation.startLine}:${citation.endLine}`
      : `page:${citation.pageTarget}:${citation.chunkId}`
    if (seen.has(key)) continue
    seen.add(key)
    wikiCounts.set(citation.wikiId, wikiCount + 1)
    diversified.push(citation)
  }

  return diversified
}

function selectDefaultRegistryCitations(
  citations: QueryRegistryCitation[],
  queryIntent: QueryIntent,
  results: QueryRegistryWikiResult[],
  options: { citationBudget: number; maxCitationsPerWiki: number },
): QueryRegistryCitation[] {
  const pool = citations
  const topScore = Math.max(0, ...pool.map((citation) => citation.score.total))
  const minScore = Math.max(0.18, topScore * 0.55)
  const strong = pool.filter((citation) => isDefaultRegistryEvidence(citation, minScore, queryIntent))
  const coherent = restrictGenericRegistryCitationsToLeadingWikis(strong, queryIntent, results)
  if (coherent.length > 0) {
    return diversifyRegistryCitations(coherent, queryIntent, options)
  }
  return []
}

function selectSurveyRegistryCitations(
  citations: QueryRegistryCitation[],
  queryIntent: QueryIntent,
  results: QueryRegistryWikiResult[],
  options: { citationBudget: number; maxCitationsPerWiki: number },
): QueryRegistryCitation[] {
  const topScore = Math.max(0, ...citations.map((citation) => citation.score.total))
  const minScore = Math.max(0.1, topScore * 0.25)
  const candidates = restrictGenericRegistryCitationsToLeadingWikis(
    citations.filter((citation) => isSurveyRegistryEvidence(citation, minScore, queryIntent)),
    queryIntent,
    results,
  )
  const documents = new Map<string, QueryRegistryCitation[]>()

  for (const citation of candidates) {
    const key = registrySourceDocumentKey(citation)
    documents.set(key, [...(documents.get(key) ?? []), citation])
  }

  const rankedDocuments = [...documents.values()]
    .map((group) => {
      const sorted = [...group].sort((left, right) => compareRegistryCitations(left, right, queryIntent))
      return {
        citation: sorted[0]!,
        score: surveyDocumentScore(sorted[0]!, queryIntent),
      }
    })
    .sort((left, right) => right.score - left.score
      || compareRegistryCitations(left.citation, right.citation, queryIntent))

  const citationBudget = options.citationBudget
  const maxDocumentsPerWiki = Math.max(options.maxCitationsPerWiki, Math.min(6, citationBudget))
  const wikiCounts = new Map<string, number>()
  const selected: QueryRegistryCitation[] = []

  for (const document of rankedDocuments) {
    if (selected.length >= citationBudget) break
    const wikiCount = wikiCounts.get(document.citation.wikiId) ?? 0
    if (wikiCount >= maxDocumentsPerWiki) continue
    wikiCounts.set(document.citation.wikiId, wikiCount + 1)
    selected.push(document.citation)
  }

  if (selected.length > 0) {
    return selected
  }
  return selectDefaultRegistryCitations(citations, queryIntent, [], options)
}

function restrictGenericRegistryCitationsToLeadingWikis(
  citations: QueryRegistryCitation[],
  queryIntent: QueryIntent,
  results: QueryRegistryWikiResult[],
): QueryRegistryCitation[] {
  if (queryIntent.hasDomainSpecificIntent || queryIntent.explicitCrossDomainIntent || citations.length === 0 || results.length === 0) {
    return citations
  }

  const citationWikiIds = new Set(citations.map((citation) => citation.wikiId))
  const rankedWikis = results
    .filter((entry) => citationWikiIds.has(entry.wikiId))
    .sort(compareRegistryResults)
  const leader = rankedWikis[0]
  if (!leader) {
    return citations
  }

  const leaderScore = Math.max(leader.calibratedScore, leader.chunkScore, 0)
  const keepWikiIds = new Set<string>([leader.wikiId])
  for (const entry of rankedWikis.slice(1)) {
    const closeToLeader = leaderScore > 0 && entry.calibratedScore >= leaderScore * 0.995
    const hasRegistrySupport = entry.score >= 2 || nonGenericProfileTerms(entry.matchedTerms).length >= 2
    if (closeToLeader && hasRegistrySupport) {
      keepWikiIds.add(entry.wikiId)
    }
  }

  return citations.filter((citation) => keepWikiIds.has(citation.wikiId))
}

function retrievalLimitForIntent(queryIntent: QueryIntent): number | undefined {
  return queryIntent.prefersDocumentReading ? 24 : undefined
}

function queryIntentProfilesForWikis(wikis: RegistryRetrievalWiki[]): QueryIntentProfile[] {
  const profiles = wikis.map((wiki) => {
    const identityTerms = uniqueProfileTerms([wiki.wikiId, wiki.title, ...(wiki.aliases ?? [])])
    const profileScopeCore = nonGenericProfileTerms([...(wiki.scopeCore ?? []), ...(wiki.scope ?? [])])
    const profileScopeAdjacent = nonGenericProfileTerms(wiki.scopeAdjacent ?? [])
    const genericProfileTerms = genericOnlyProfileTerms([
      ...wiki.matchedTerms,
      ...(wiki.scopeCore ?? []),
      ...(wiki.scope ?? []),
      ...(wiki.scopeAdjacent ?? []),
    ])
    const coreTerms = uniqueProfileTerms([
      ...identityTerms,
      ...profileScopeCore,
    ])
    const supportTerms = uniqueProfileTerms([
      ...profileScopeAdjacent,
    ])
    return {
      domain: `wiki:${wiki.wikiId}`,
      core: coreTerms,
      support: supportTerms,
      generic: uniqueProfileTerms(genericProfileTerms.filter((term) => !coreTerms.includes(term) && !supportTerms.includes(term))),
      negative: [],
      focus: uniqueProfileTerms([...coreTerms, ...supportTerms]),
    }
  })
  const profileDomains = profiles.map((profile) => profile.domain)
  return profiles.map((profile) => ({
    ...profile,
    negative: profileDomains.filter((domain) => domain !== profile.domain),
  }))
}

function isSurveyRegistryEvidence(citation: QueryRegistryCitation, minScore: number, queryIntent: QueryIntent): boolean {
  if (!citation.rawPath || citation.evidenceKind === 'wiki') {
    return false
  }
  if (!isReadableRegistryCitation(citation)) {
    return false
  }
  const evidence = citationEvidenceForIntent(citation)
  const fit = scoreEvidenceIntentFit(queryIntent, evidence)
  if (!isEvidenceDomainConsistent(queryIntent, evidence, { minScore: 0.58, minMargin: 0.25 })) {
    return false
  }
  if (!isFocusedEvidenceForIntent(queryIntent, evidence)) {
    return false
  }
  if (citation.score.total >= minScore) {
    return true
  }
  if (fit.strong && fit.margin >= 0.25 && citation.score.embedding >= 0.35) {
    return true
  }
  return isMeaningfulNonEmbeddingSupport(citation.score)
}

function surveyDocumentScore(citation: QueryRegistryCitation, queryIntent: QueryIntent): number {
  const fit = scoreEvidenceIntentFit(queryIntent, citationEvidenceForIntent(citation)).score
  const nonEmbedding = isMeaningfulNonEmbeddingSupport(citation.score) ? 0.08 : 0
  return round(citation.score.total
    + citation.score.rerank * 0.35
    + fit * 0.18
    + citation.score.embedding * 0.08
    + nonEmbedding)
}

function registrySourceDocumentKey(citation: QueryRegistryCitation): string {
  return [
    citation.wikiId,
    citation.rawPath ?? citation.sourceRef ?? citation.filePath ?? citation.pageTarget,
  ].join('|')
}

const REGISTRY_RERANK_WEIGHT = 0.5

async function rerankRegistryCitations(input: {
  question: string
  citations: QueryRegistryCitation[]
  queryIntent: QueryIntent
  passagesByCitation: Map<string, QuerySourceReadingPack['passages'][number]>
  citationBudget: number
  diagnostics: string[]
  config?: RerankConfig | null
  reranker?: Reranker
}): Promise<QueryRegistryCitation[]> {
  const config = input.config === undefined ? loadRerankConfigFromEnv() : input.config
  if (!config || input.citations.length === 0) {
    return input.citations
  }

  const base = [...input.citations].sort((left, right) => compareRegistryCitations(left, right, input.queryIntent))
  const candidateCount = Math.min(Math.max(input.citationBudget * 6, input.citationBudget, 1), config.topN, base.length)
  const candidates = base.slice(0, candidateCount)
  const passthrough = base.slice(candidateCount)
  const reranker = input.reranker ?? new LocalHttpReranker()

  try {
    const scores = await reranker.rerank({
      question: input.question,
      candidates: candidates.map((citation) => ({
        chunkId: registryCitationKey(citation),
        text: registryRerankText(citation, input.passagesByCitation),
      })),
      config,
    })
    if (scores.size === 0) {
      input.diagnostics.push('registry rerank endpoint returned no usable scores; using fused order')
      return input.citations
    }

    const reranked = candidates
      .map((citation, index) => withRegistryRerankScore(citation, scores.get(registryCitationKey(citation)), index))
      .sort((left, right) => right.score.rerank - left.score.rerank
        || compareRegistryCitations(left, right, input.queryIntent))
    input.diagnostics.push(`registry rerank applied to top ${candidateCount} candidate(s)`)
    return [...reranked, ...passthrough]
  } catch (error) {
    input.diagnostics.push(`registry rerank unavailable; using fused order: ${(error as Error).message}`)
    return input.citations
  }
}

function withRegistryRerankScore(citation: QueryRegistryCitation, score: number | undefined, index: number): QueryRegistryCitation {
  if (score === undefined || !Number.isFinite(score)) {
    return {
      ...citation,
      reasons: [...citation.reasons, `registry-rerank:missing:${index}`],
    }
  }
  const rerank = round(normalizeRerankScore(score))
  return {
    ...citation,
    score: {
      ...citation.score,
      rerank,
      total: round(citation.score.total + (rerank * REGISTRY_RERANK_WEIGHT)),
    },
    reasons: [...citation.reasons, `registry-rerank:score:${rerank.toFixed(3)}`],
  }
}

function registryRerankText(citation: QueryRegistryCitation, passagesByCitation: Map<string, QuerySourceReadingPack['passages'][number]>): string {
  return passagesByCitation.get(registryCitationKey(citation))?.text ?? citation.excerpt
}

function normalizeRerankScore(value: number): number {
  if (value >= 0 && value <= 1) {
    return value
  }
  return 1 / (1 + Math.exp(-value))
}

function isDefaultRegistryEvidence(citation: QueryRegistryCitation, minScore: number, queryIntent: QueryIntent): boolean {
  if (!citation.rawPath || citation.evidenceKind === 'wiki') {
    return false
  }
  if (!isReadableRegistryCitation(citation)) {
    return false
  }
  if (citation.score.total < minScore) {
    return false
  }
  const evidence = citationEvidenceForIntent(citation)
  if (!isEvidenceDomainConsistent(queryIntent, evidence, { minScore: 0.5, minMargin: 0.2 })) {
    return false
  }
  if (isMeaningfulNonEmbeddingSupport(citation.score)) {
    return true
  }
  if (!isEmbeddingOnlyScore(citation.score)) {
    return isStrongSemanticEvidence({
      intent: queryIntent,
      evidence,
    })
  }
  return isStrongSemanticEvidence({
    intent: queryIntent,
    evidence,
  })
}

function isRegistryAnswerEvidence(citation: QueryRegistryCitation, answerableWikiIds: Set<string>): boolean {
  if (citation.rawPath && citation.evidenceKind !== 'wiki') {
    return true
  }
  return answerableWikiIds.has(citation.wikiId)
}

function isReadableRegistryCitation(citation: QueryRegistryCitation): boolean {
  const text = citation.excerpt.replace(/\s+/g, ' ').trim()
  if (text.length < 40) {
    return false
  }
  const htmlTagCount = (text.match(/<\/?(?:td|tr|table|tbody|thead|th)\b/gi) ?? []).length
  if (htmlTagCount >= 2) {
    return false
  }
  const readableChars = (text.match(/[\p{L}\p{N}\u4e00-\u9fff]/gu) ?? []).length
  return readableChars / Math.max(text.length, 1) >= 0.35
}

function buildRegistryAgentReadingPack(input: {
  results: QueryRegistryWikiResult[]
  selectedWikis: QueryRegistryResult['selectedWikis']
  citations: QueryRegistryCitation[]
  diagnostics: QueryRegistryDiagnostics
  answerability: QueryRegistryAgentReadingPack['answerability']
}): QueryRegistryAgentReadingPack {
  const answered = input.answerability === 'answered'
  return {
    answerability: answered ? 'answered' : 'insufficient-evidence',
    retrievalMode: 'registry-hybrid',
    embeddingUsed: input.results.some((entry) => (entry.retrievalSignals?.signalCounts.embedding ?? 0) > 0),
    citationCount: input.citations.length,
    mustReadFurther: answered,
    searchedWikis: input.selectedWikis.map(({ wikiId, title, knowledgeRoot, chunkScore }) => ({ wikiId, title, knowledgeRoot, chunkScore })),
    citationsToRead: input.citations.map((citation, index) => ({
      citationIndex: index + 1,
      wikiId: citation.wikiId,
      wikiTitle: citation.wikiTitle,
      target: citation.target,
      title: citation.title,
      filePath: citation.filePath,
      heading: citation.heading,
      startLine: citation.startLine,
      endLine: citation.endLine,
      sourceRef: citation.sourceRef,
      rawPath: citation.rawPath,
      artifactId: citation.artifactId,
      evidenceKind: citation.evidenceKind,
      chunkId: citation.chunkId,
    })),
    diagnostics: input.diagnostics,
    perWikiReadingPacks: input.results.map((entry) => ({ wikiId: entry.wikiId, agentReadingPack: entry.result?.agentReadingPack ?? null })),
  }
}

function compareRegistryCitations(left: QueryRegistryCitation, right: QueryRegistryCitation, queryIntent: QueryIntent): number {
  const leftFit = scoreEvidenceIntentFit(queryIntent, citationEvidenceForIntent(left))
  const rightFit = scoreEvidenceIntentFit(queryIntent, citationEvidenceForIntent(right))
  return right.score.total - left.score.total
    || right.score.rerank - left.score.rerank
    || right.score.lexical - left.score.lexical
    || rightFit.margin - leftFit.margin
    || rightFit.score - leftFit.score
    || right.score.embedding - left.score.embedding
    || left.wikiId.localeCompare(right.wikiId)
}

function citationEvidenceForIntent(citation: QueryRegistryCitation): EvidenceForIntent {
  return {
    wikiId: citation.wikiId,
    wikiTitle: citation.wikiTitle,
    title: citation.title,
    heading: citation.heading,
    excerpt: citation.excerpt,
    score: citation.score,
  }
}

function round(value: number): number {
  return Number(value.toFixed(6))
}

function uniqueProfileTerms(terms: string[]): string[] {
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
}

const GENERIC_PROFILE_TERMS = new Set([
  'ai',
  'agent',
  'agents',
  'architecture',
  'automation',
  'benchmark',
  'benchmarks',
  'data',
  'dataset',
  'evaluation',
  'framework',
  'frameworks',
  'graph',
  'learning',
  'llm',
  'market',
  'method',
  'methods',
  'model',
  'models',
  'research',
  'strategy',
  'system',
  'systems',
  'task',
  'tasks',
  'workflow',
])

function nonGenericProfileTerms(terms: string[]): string[] {
  return terms.filter((term) => !isGenericProfileTerm(term))
}

function genericOnlyProfileTerms(terms: string[]): string[] {
  return terms.filter(isGenericProfileTerm)
}

function isGenericProfileTerm(term: string): boolean {
  const normalized = term.toLowerCase().trim()
  if (!normalized) {
    return true
  }
  const tokens = normalized.split(/[^a-z0-9\u4e00-\u9fff]+/u).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => GENERIC_PROFILE_TERMS.has(token))
}

function buildRegistryAnswer(
  question: string,
  results: QueryRegistryWikiResult[],
  citations: QueryRegistryCitation[],
  answerability: QueryRegistryAgentReadingPack['answerability'],
): string {
  if (answerability === 'insufficient-evidence') {
    const errors = results.filter((entry) => entry.error).map((entry) => `${entry.wikiId}: ${entry.error}`).join('; ')
    return `I searched ${results.length} registered wiki(s) for "${question}" but did not find enough source-backed evidence to answer.${errors ? ` Query errors: ${errors}` : ''}`
  }

  const wikiTitles = new Map(results.map((entry) => [entry.wikiId, entry.title]))
  const byWiki = new Map<string, QueryRegistryCitation[]>()
  for (const citation of citations) {
    byWiki.set(citation.wikiId, [...(byWiki.get(citation.wikiId) ?? []), citation])
  }

  const wikiSections = [...byWiki.entries()].map(([wikiId, wikiCitations]) => [
    `## ${wikiTitles.get(wikiId) ?? wikiId} (${wikiId})`,
    ...wikiCitations.map((citation, index) => {
      const span = citation.startLine && citation.endLine ? ` lines ${citation.startLine}-${citation.endLine}` : ''
      const evidence = citation.rawPath ? ` raw=${citation.rawPath}` : ''
      return `${index + 1}. ${citation.title} (${citation.target}${span})${evidence}: ${citation.excerpt}`
    }),
    `Citations: ${wikiCitations.map((citation) => `${wikiId}:${citation.target}${citation.chunkId ? `#${citation.chunkId.slice(0, 14)}` : ''}`).join(', ')}`,
  ].join('\n')).join('\n\n')
  return `Question: ${question}\n\n${wikiSections}`
}
