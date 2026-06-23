import { createHash } from 'node:crypto'
import { buildSourceParentSpans, lineRangeForWindow } from '../retrieval/chunking.js'
import { approximateTokenCount } from '../retrieval/tokenize.js'
import type { SourceParentSpanIndexEntry } from '../retrieval/types.js'
import { parseWikiLinks, type IndexedPage } from '../wiki/links.js'
import type { ChunkIndexEntry, PageEvidenceSource } from './wiki-index.js'
import { buildHeadingPath, extractHeadings } from './headings.js'

const CHUNK_TEXT_WINDOW_CHARS = 512
const CHUNK_TEXT_OVERLAP_CHARS = 64
const PARENT_SPAN_WINDOW_CHARS = 1_800

export function chunkPage(page: IndexedPage, evidence: PageEvidenceSource): { chunks: ChunkIndexEntry[]; parentSpans: SourceParentSpanIndexEntry[] } {
  const content = evidence.content
  const lines = content.split('\n')
  const headingLines = extractHeadings(content)
  const boundaries = headingLines.length > 0
    ? headingLines.map((heading) => ({ ...heading, lineIndex: heading.lineIndex }))
    : [{ level: 1, text: 'Document', lineIndex: 0 }]
  const chunks: ChunkIndexEntry[] = []
  const parentSpans: SourceParentSpanIndexEntry[] = []
  const usedIds = new Map<string, number>()
  const sourceRef = evidence.sourceRef
  const privacyMetadata = evidence.privacyMetadata
  let chunkOrder = 0
  let previousChunk: ChunkIndexEntry | null = null

  for (let index = 0; index < boundaries.length; index += 1) {
    const current = boundaries[index]
    const next = boundaries[index + 1]
    const startLine = current.lineIndex + 1
    const endLine = next ? next.lineIndex : lines.length
    const sectionText = lines.slice(current.lineIndex, endLine).join('\n').trim()
    if (!sectionText) {
      continue
    }
    const heading = current.text || 'Document'
    const headingPath = buildHeadingPath(headingLines, current.lineIndex, heading)
    const anchor = slugify(heading)
    const baseId = `${page.target}#${anchor}`
    const metadata: ChunkIndexEntry['metadata'] = {
      docType: page.section === 'sources' ? 'source' : page.section.replace(/s$/, ''),
      section: page.section,
      slug: page.slug,
      sourceKind: evidence.sourceKind ?? undefined,
      ...privacyMetadata,
    }
    const spans = buildSourceParentSpans(sectionText, {
      parentWindowChars: PARENT_SPAN_WINDOW_CHARS,
      childWindowChars: CHUNK_TEXT_WINDOW_CHARS,
      childOverlapChars: CHUNK_TEXT_OVERLAP_CHARS,
    })
    for (const [spanIndex, span] of spans.entries()) {
      const parentTextSha256 = createHash('sha256').update(span.text).digest('hex')
      const parentRange = lineRangeForWindow(sectionText, startLine, span.startOffset, span.endOffset)
      const parentSpanId = `sha256:${createHash('sha256').update(`${page.target}\nparent\n${parentRange.startLine}\n${parentRange.endLine}\n${span.startOffset}\n${span.endOffset}\n${parentTextSha256}`).digest('hex')}`
      const parentChildChunkIds: string[] = []

      for (const window of span.childWindows) {
        const id = uniqueChunkId(`${baseId}:child-${spanIndex + 1}`, usedIds)
        const textSha256 = createHash('sha256').update(window.text).digest('hex')
        const range = lineRangeForWindow(sectionText, startLine, window.startOffset, window.endOffset)
        const chunkId = `sha256:${createHash('sha256').update(`${page.target}\n${range.startLine}\n${range.endLine}\n${window.startOffset}\n${window.endOffset}\n${textSha256}`).digest('hex')}`
        const chunk: ChunkIndexEntry = {
          version: 2,
          id,
          chunkId,
          parentSpanId,
          pageTarget: page.target,
          pageTitle: page.title,
          filePath: evidence.filePath,
          sourceRef,
          rawPath: evidence.rawPath,
          artifactId: evidence.artifactId,
          evidenceKind: evidence.evidenceKind,
          heading,
          headingPath,
          level: current.level,
          startLine: range.startLine,
          endLine: range.endLine,
          startOffset: window.startOffset,
          endOffset: window.endOffset,
          parentStartLine: parentRange.startLine,
          parentEndLine: parentRange.endLine,
          parentStartOffset: span.startOffset,
          parentEndOffset: span.endOffset,
          chunkOrder,
          prevChunkId: previousChunk?.chunkId ?? null,
          nextChunkId: null,
          sourceBlockRefs: span.sourceBlockRefs,
          anchor,
          text: window.text,
          textSha256,
          tokenCountApprox: approximateTokenCount(window.text),
          links: page.section === 'readings' ? [] : parseWikiLinks(window.text).map((link) => link.rawTarget),
          metadata,
        }
        if (previousChunk) {
          previousChunk.nextChunkId = chunk.chunkId
        }
        chunks.push(chunk)
        parentChildChunkIds.push(chunk.chunkId)
        previousChunk = chunk
        chunkOrder += 1
      }

      parentSpans.push({
        version: 1,
        parentSpanId,
        pageTarget: page.target,
        pageTitle: page.title,
        filePath: evidence.filePath,
        sourceRef,
        rawPath: evidence.rawPath,
        artifactId: evidence.artifactId,
        evidenceKind: evidence.evidenceKind,
        heading,
        headingPath,
        level: current.level,
        startLine: parentRange.startLine,
        endLine: parentRange.endLine,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        anchor,
        text: span.text,
        textSha256: parentTextSha256,
        tokenCountApprox: approximateTokenCount(span.text),
        childChunkIds: parentChildChunkIds,
        splitStrategy: span.splitStrategy,
        sourceBlockRefs: span.sourceBlockRefs,
        metadata,
      })
    }
  }

  return { chunks, parentSpans }
}

export function extractPrivacyMetadata(content: string): Pick<ChunkIndexEntry['metadata'], 'privacy' | 'sensitive'> {
  const frontmatter = parseSimpleFrontmatter(content)
  const privacy = normalizePrivacy(frontmatter.privacy)
  const sensitive = normalizeBoolean(frontmatter.sensitive) || privacy === 'sensitive'
  return {
    ...(privacy ? { privacy } : {}),
    ...(sensitive ? { sensitive: true } : {}),
  }
}

function parseSimpleFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---\n')) {
    return {}
  }
  const closingIndex = content.indexOf('\n---\n', 4)
  if (closingIndex === -1) {
    return {}
  }
  const result: Record<string, string> = {}
  for (const line of content.slice(4, closingIndex).split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    result[key] = value
  }
  return result
}

function normalizePrivacy(value: string | undefined): ChunkIndexEntry['metadata']['privacy'] | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'private' || normalized === 'sensitive') {
    return normalized
  }
  if (normalized === 'default' || normalized === 'public') {
    return 'default'
  }
  return undefined
}

function normalizeBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

function uniqueChunkId(baseId: string, usedIds: Map<string, number>): string {
  const count = usedIds.get(baseId) ?? 0
  usedIds.set(baseId, count + 1)
  return count === 0 ? baseId : `${baseId}-${count + 1}`
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chunk'
}
