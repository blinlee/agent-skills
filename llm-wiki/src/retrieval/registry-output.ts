import type {
  QueryRegistryAgentReadingPack,
  QueryRegistryCitation,
  QueryRegistryDiagnostics,
  QueryRegistryResult,
  QueryRegistryWikiResult,
} from './registry.js'

export function buildRegistryAgentReadingPack(input: {
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

export function buildRegistryAnswer(
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
