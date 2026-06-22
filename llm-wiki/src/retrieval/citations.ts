import type { ChunkIndexEntryV2, RetrievalCitation } from './types.js'

export function buildCitation(chunk: ChunkIndexEntryV2): RetrievalCitation {
  return {
    chunkId: chunk.chunkId,
    pageTarget: chunk.pageTarget,
    pageTitle: chunk.pageTitle,
    heading: chunk.heading,
    headingPath: chunk.headingPath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    sourceRef: chunk.sourceRef,
    rawPath: chunk.rawPath ?? null,
    artifactId: chunk.artifactId ?? null,
    evidenceKind: chunk.evidenceKind ?? (chunk.rawPath ? 'raw' : 'wiki'),
    filePath: chunk.filePath,
    excerpt: buildExcerpt(chunk.text),
  }
}

export function buildExcerpt(markdown: string): string {
  return compact(markdown.replace(/^# .*$/m, '')).slice(0, 280)
}

export function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
