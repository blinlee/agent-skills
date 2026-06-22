import { displaySourceTitle } from '../query/source-title.js'
import type { QueryCitation, QuerySourceReadingPack } from '../query/query.js'
import type {
  QueryRegistryAgentReadingPack,
  QueryRegistryCitation,
  QueryRegistrySourceDocument,
  QueryRegistrySourceReadingPack,
  QueryRegistryWikiResult,
} from './registry.js'

export function buildRegistrySourceReadingPack(
  answerability: QueryRegistryAgentReadingPack['answerability'],
  citations: QueryRegistryCitation[],
  results: QueryRegistryWikiResult[],
  passagesByCitation = registryPassagesByCitation(results),
  readingMode: QueryRegistrySourceReadingPack['readingMode'] = 'passage',
): QueryRegistrySourceReadingPack {
  const passages = dedupeRegistryPassages(citations.map((citation, index) => {
    const passage = passagesByCitation.get(registryCitationKey(citation))
    if (passage) {
      return {
        ...passage,
        citationIndex: index + 1,
        wikiId: citation.wikiId,
        wikiTitle: citation.wikiTitle,
      }
    }
    return {
      ...registryPassageFromCitation(citation, index),
      wikiId: citation.wikiId,
      wikiTitle: citation.wikiTitle,
    }
  }))
  const documents = readingMode === 'document' ? buildRegistrySourceDocuments(passages) : undefined
  const pack: QueryRegistrySourceReadingPack = {
    answerability,
    readingMode,
    passageCount: passages.length,
    passages,
  }
  if (documents) {
    pack.documentCount = documents.length
    pack.documents = documents
  }
  return pack
}

export function registryPassagesByCitation(results: QueryRegistryWikiResult[]): Map<string, QuerySourceReadingPack['passages'][number]> {
  const map = new Map<string, QuerySourceReadingPack['passages'][number]>()
  for (const entry of results) {
    const result = entry.result
    if (!result) {
      continue
    }
    for (const passage of result.sourceReadingPack.passages) {
      const citation = result.citations[passage.citationIndex - 1]
      if (!citation) {
        continue
      }
      map.set(registryCitationKey({ ...citation, wikiId: entry.wikiId }), passage)
    }
  }
  return map
}

export function registryCitationKey(citation: Pick<QueryRegistryCitation, 'wikiId'> & Pick<QueryCitation, 'chunkId' | 'target' | 'startLine' | 'endLine' | 'sourceRef'>): string {
  return citation.chunkId
    ? `${citation.wikiId}:chunk:${citation.chunkId}`
    : `${citation.wikiId}:source:${citation.sourceRef ?? citation.target}:${citation.startLine ?? ''}:${citation.endLine ?? ''}`
}

function dedupeRegistryPassages(passages: QueryRegistrySourceReadingPack['passages']): QueryRegistrySourceReadingPack['passages'] {
  const seen = new Set<string>()
  const deduped: QueryRegistrySourceReadingPack['passages'] = []
  for (const passage of passages) {
    const key = registryPassageDedupeKey(passage)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(passage)
  }
  return deduped
}

function registryPassageDedupeKey(passage: QueryRegistrySourceReadingPack['passages'][number]): string {
  const normalizedText = passage.text.replace(/\s+/g, ' ').trim().slice(0, 400)
  return [
    passage.wikiId,
    passage.rawPath ?? passage.filePath,
    passage.sourceRef ?? '',
    passage.startLine ?? '',
    passage.endLine ?? '',
    normalizedText,
  ].join('|')
}

function buildRegistrySourceDocuments(passages: QueryRegistrySourceReadingPack['passages']): QueryRegistrySourceDocument[] {
  const documents = new Map<string, QueryRegistrySourceDocument>()
  for (const passage of passages) {
    const key = [
      passage.wikiId,
      passage.rawPath ?? passage.sourceRef ?? passage.filePath,
    ].join('|')
    const existing = documents.get(key)
    if (existing) {
      existing.selectedPassageIndexes.push(passage.citationIndex)
      continue
    }
    documents.set(key, {
      documentIndex: documents.size + 1,
      wikiId: passage.wikiId,
      wikiTitle: passage.wikiTitle,
      sourceTitle: displaySourceTitle({
        title: passage.sourceTitle,
        sourceRef: passage.sourceRef,
        rawPath: passage.rawPath,
        filePath: passage.filePath,
      }),
      sourceRef: passage.sourceRef,
      rawPath: passage.rawPath ?? null,
      filePath: passage.rawPath ?? passage.filePath,
      evidenceKind: passage.evidenceKind,
      selectedPassageIndexes: [passage.citationIndex],
    })
  }
  return [...documents.values()]
}

function registryPassageFromCitation(citation: QueryRegistryCitation, index: number): QueryRegistrySourceReadingPack['passages'][number] {
  const text = citation.excerpt
  return {
    citationIndex: index + 1,
    wikiId: citation.wikiId,
    wikiTitle: citation.wikiTitle,
    sourceTitle: displaySourceTitle(citation),
    sourceRef: citation.sourceRef,
    rawPath: citation.rawPath ?? null,
    filePath: citation.rawPath ?? citation.filePath,
    evidenceKind: citation.evidenceKind,
    headingPath: citation.headingPath,
    heading: citation.heading,
    startLine: citation.startLine,
    endLine: citation.endLine,
    text,
    truncated: text.length >= 360,
    stitchedFromChunkIds: citation.chunkId ? [citation.chunkId] : [],
  }
}
