import type { QueryRegistryCitation, QueryRegistryDiagnostics, QueryRegistryWikiResult } from './registry.js'

export function buildRegistryDiagnostics(input: {
  selectedWikiCount: number
  results: QueryRegistryWikiResult[]
  citationCountBeforeDedupe: number
  citationCountAfterDedupe: number
  selectedCitations: QueryRegistryCitation[]
  citationBudget: number
  maxCitationsPerWiki: number
  maxConcurrentWikis: number
  registryRerankDiagnostics: string[]
}): QueryRegistryDiagnostics {
  return {
    fusionPolicy: 'selectedCitationRank asc -> calibratedScore desc -> chunkScore desc -> profile score desc -> topEmbedding desc -> wikiId asc',
    selectedWikiCount: input.selectedWikiCount,
    resultWikiCount: input.results.length,
    errorCount: input.results.filter((entry) => entry.error).length,
    citationCountBeforeDedupe: input.citationCountBeforeDedupe,
    citationCountAfterDedupe: input.citationCountAfterDedupe,
    rawBackedCitationCountBeforeDedupe: countRawBackedCitations(input.results.flatMap((entry) => entry.citationPack)),
    derivedCitationCountBeforeDedupe: countDerivedCitations(input.results.flatMap((entry) => entry.citationPack)),
    rawBackedCitationCountAfterDedupe: countRawBackedCitations(input.selectedCitations),
    derivedCitationCountAfterDedupe: countDerivedCitations(input.selectedCitations),
    citationBudget: input.citationBudget,
    maxCitationsPerWiki: input.maxCitationsPerWiki,
    maxConcurrentWikis: input.maxConcurrentWikis,
    registryRerankDiagnostics: input.registryRerankDiagnostics,
    embeddingDegradedWikis: input.results
      .map((entry) => ({
        wikiId: entry.wikiId,
        diagnostics: entry.retrievalDiagnostics.filter((diagnostic) => diagnostic.includes('embedding')),
      }))
      .filter((entry) => entry.diagnostics.length > 0),
    readiness: registryReadinessSummary(input.results),
    errors: input.results
      .filter((entry) => entry.error)
      .map((entry) => ({ wikiId: entry.wikiId, error: entry.error! })),
    averageDurationMs: average(input.results.map((entry) => entry.durationMs)),
    perWikiMetrics: input.results.map((entry) => ({
      wikiId: entry.wikiId,
      status: registryWikiStatus(entry),
      durationMs: entry.durationMs,
      profileScore: entry.score,
      chunkScore: entry.chunkScore,
      calibratedScore: entry.calibratedScore,
      citationCount: entry.citationPack.length,
      error: entry.error,
    })),
  }
}

function countRawBackedCitations(citations: QueryRegistryCitation[]): number {
  return citations.filter((citation) => citation.rawPath && citation.evidenceKind !== 'wiki').length
}

function countDerivedCitations(citations: QueryRegistryCitation[]): number {
  return citations.filter((citation) => !citation.rawPath || citation.evidenceKind === 'wiki').length
}

function registryWikiStatus(entry: QueryRegistryWikiResult): QueryRegistryDiagnostics['perWikiMetrics'][number]['status'] {
  if (entry.error) {
    return 'error'
  }
  if (entry.retrievalSignals?.mode === 'stale-index' || entry.retrievalDiagnostics.some((diagnostic) => diagnostic.includes('stale-index'))) {
    return 'stale-index'
  }
  if (entry.result?.grounding.answerability === 'answered') {
    return 'answered'
  }
  if (entry.citationPack.length > 0 || entry.result?.grounding.answerability === 'insufficient-evidence') {
    return 'insufficient-evidence'
  }
  if (entry.retrievalDiagnostics.some((diagnostic) => diagnostic.includes('embedding'))) {
    return 'embedding-degraded'
  }
  return 'no-match'
}

function registryReadinessSummary(results: QueryRegistryWikiResult[]): QueryRegistryDiagnostics['readiness'] {
  const wikis = results.map((entry) => ({
    wikiId: entry.wikiId,
    status: entry.readiness?.status ?? 'missing-index',
    indexStatus: entry.readiness?.index.status ?? 'missing',
    embeddingStatus: entry.readiness?.embedding.status ?? 'missing-index',
    currentChunkCount: entry.readiness?.embedding.currentChunkCount ?? 0,
    reusableVectorCount: entry.readiness?.embedding.reusableVectorCount ?? 0,
    missingVectorCount: entry.readiness?.embedding.missingVectorCount ?? 0,
  }))
  const blocked = wikis.filter((wiki) => wiki.status === 'missing-index' || wiki.status === 'stale-index').length
  const partial = wikis.filter((wiki) => wiki.status === 'embedding-missing').length
  return {
    status: blocked === wikis.length && wikis.length > 0 ? 'blocked' : blocked > 0 || partial > 0 ? 'partial' : 'ready',
    wikis,
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0
  }
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(3))
}
