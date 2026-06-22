import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChunkIndexEntryV2, ChunkIndexStateV2, SourceParentSpanIndexEntry } from '../retrieval/types.js'
import { displaySourceTitle } from './source-title.js'
import type { QueryCitation, QueryGroundingDiagnostics, QuerySourceReadingPack, QuerySourceReadingPassage } from './query.js'

const MAX_SOURCE_READING_PASSAGE_CHARS = 2400

type SourceReadingIndex = {
  chunksById: Map<string, ChunkIndexEntryV2>
  parentSpansById: Map<string, SourceParentSpanIndexEntry>
}

export async function buildSourceReadingPack(
  knowledgeRoot: string,
  answerability: QueryGroundingDiagnostics['answerability'],
  citations: QueryCitation[],
  redactor: (text: string) => string = (text) => text,
): Promise<QuerySourceReadingPack> {
  const indexState = await loadChunkIndexForSourceReading(knowledgeRoot)
  const passages = citations.map((citation, index) =>
    buildSourceReadingPassage(indexState, citation, index, redactor))

  return {
    answerability,
    readingMode: 'passage',
    passageCount: passages.length,
    passages,
  }
}

async function loadChunkIndexForSourceReading(knowledgeRoot: string): Promise<SourceReadingIndex | null> {
  try {
    const raw = await readFile(path.join(path.resolve(knowledgeRoot), 'system', 'index', 'chunks.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ChunkIndexStateV2>
    if (parsed.version !== 2 || parsed.schema !== 'llm-wiki.chunks.v2' || !Array.isArray(parsed.chunks)) {
      return null
    }
    return {
      chunksById: new Map(parsed.chunks.map((chunk) => [chunk.chunkId, chunk])),
      parentSpansById: new Map((parsed.parentSpans ?? []).map((span) => [span.parentSpanId, span])),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function buildSourceReadingPassage(
  indexState: SourceReadingIndex | null,
  citation: QueryCitation,
  index: number,
  redactor: (text: string) => string,
): QuerySourceReadingPassage {
  const chunk = citation.chunkId ? indexState?.chunksById.get(citation.chunkId) ?? null : null
  const expanded = chunk ? expandSourcePassageFromChunk(indexState, chunk) : null
  if (!expanded) {
    return sourceReadingPassageFromCitation(citation, index, redactor)
  }

  const text = redactor(expanded.text)
  return {
    citationIndex: index + 1,
    sourceTitle: redactor(displaySourceTitle(citation)),
    sourceRef: citation.sourceRef,
    rawPath: citation.rawPath ?? expanded.rawPath ?? null,
    filePath: citation.rawPath ?? expanded.filePath,
    evidenceKind: citation.evidenceKind ?? expanded.evidenceKind,
    headingPath: citation.headingPath?.map((heading) => redactor(heading)) ?? expanded.headingPath?.map((heading) => redactor(heading)),
    heading: citation.heading || expanded.heading ? redactor(citation.heading ?? expanded.heading ?? '') : undefined,
    startLine: expanded.startLine,
    endLine: expanded.endLine,
    text,
    truncated: expanded.truncated || text.length >= MAX_SOURCE_READING_PASSAGE_CHARS,
    stitchedFromChunkIds: expanded.stitchedFromChunkIds,
  }
}

function sourceReadingPassageFromCitation(
  citation: QueryCitation,
  index: number,
  redactor: (text: string) => string,
): QuerySourceReadingPassage {
  const text = redactor(citation.excerpt)
  return {
    citationIndex: index + 1,
    sourceTitle: redactor(displaySourceTitle(citation)),
    sourceRef: citation.sourceRef,
    rawPath: citation.rawPath ?? null,
    filePath: citation.rawPath ?? citation.filePath,
    evidenceKind: citation.evidenceKind,
    headingPath: citation.headingPath?.map((heading) => redactor(heading)),
    heading: citation.heading ? redactor(citation.heading) : citation.heading,
    startLine: citation.startLine,
    endLine: citation.endLine,
    text,
    truncated: text.length >= 360,
    stitchedFromChunkIds: citation.chunkId ? [citation.chunkId] : [],
  }
}

function expandSourcePassageFromChunk(
  indexState: SourceReadingIndex | null,
  chunk: ChunkIndexEntryV2,
): Omit<QuerySourceReadingPassage, 'citationIndex' | 'sourceTitle'> | null {
  if (!indexState) {
    return null
  }

  const parent = chunk.parentSpanId ? indexState.parentSpansById.get(chunk.parentSpanId) ?? null : null
  if (parent && parent.text.trim() && parent.text.length <= MAX_SOURCE_READING_PASSAGE_CHARS) {
    return {
      sourceRef: parent.sourceRef,
      rawPath: parent.rawPath ?? null,
      filePath: parent.rawPath ?? parent.filePath,
      evidenceKind: parent.evidenceKind,
      headingPath: parent.headingPath,
      heading: parent.heading,
      startLine: parent.startLine,
      endLine: parent.endLine,
      text: normalizeSourcePassageText(parent.text),
      truncated: false,
      stitchedFromChunkIds: parent.childChunkIds.length > 0 ? parent.childChunkIds : [chunk.chunkId],
    }
  }

  const stitched = stitchNeighborChunks(indexState, chunk)
  if (stitched.length === 0) {
    return null
  }
  const text = compactSourcePassageText(joinChunkTexts(stitched.map((entry) => entry.text)), MAX_SOURCE_READING_PASSAGE_CHARS)
  return {
    sourceRef: chunk.sourceRef,
    rawPath: chunk.rawPath ?? null,
    filePath: chunk.rawPath ?? chunk.filePath,
    evidenceKind: chunk.evidenceKind,
    headingPath: chunk.headingPath,
    heading: chunk.heading,
    startLine: Math.min(...stitched.map((entry) => entry.startLine)),
    endLine: Math.max(...stitched.map((entry) => entry.endLine)),
    text,
    truncated: parent !== null || text.includes('...(truncated)'),
    stitchedFromChunkIds: stitched.map((entry) => entry.chunkId),
  }
}

function stitchNeighborChunks(indexState: SourceReadingIndex, chunk: ChunkIndexEntryV2): ChunkIndexEntryV2[] {
  const candidates = [
    chunk.prevChunkId ? indexState.chunksById.get(chunk.prevChunkId) : null,
    chunk,
    chunk.nextChunkId ? indexState.chunksById.get(chunk.nextChunkId) : null,
  ].filter((entry): entry is ChunkIndexEntryV2 => Boolean(entry))
    .filter((entry) => entry.pageTarget === chunk.pageTarget)
    .filter((entry) => !chunk.parentSpanId || entry.parentSpanId === chunk.parentSpanId)

  return dedupeBy(candidates, (entry) => entry.chunkId)
    .sort((left, right) => (left.chunkOrder ?? 0) - (right.chunkOrder ?? 0))
}

function joinChunkTexts(texts: string[]): string {
  let output = ''
  for (const rawText of texts) {
    const text = normalizeSourcePassageText(rawText)
    if (!text) {
      continue
    }
    output = output ? appendWithOverlap(output, text) : text
  }
  return output
}

function appendWithOverlap(current: string, next: string): string {
  const maxOverlap = Math.min(180, current.length, next.length)
  for (let size = maxOverlap; size >= 40; size -= 1) {
    if (current.slice(-size) === next.slice(0, size)) {
      return `${current}${next.slice(size)}`
    }
  }
  return `${current}\n\n${next}`
}

function normalizeSourcePassageText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
}

function compactSourcePassageText(value: string, maxChars: number): string {
  const normalized = normalizeSourcePassageText(value)
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 16)).trimEnd()} ...(truncated)`
}

function dedupeBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = keyFor(item)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(item)
  }
  return result
}
