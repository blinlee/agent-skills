import path from 'node:path'
import type { NormalizedArtifact, SourceKind } from '../types'

export type ParserSourceInput = {
  sourceId: string
  path: string
  content: string
  parsedAt?: string
}

export type ParsedArtifact<TKind extends SourceKind = SourceKind> = Omit<NormalizedArtifact, 'sourceKind'> & {
  sourceKind: TKind
}

export interface SourceParser<TKind extends SourceKind = SourceKind> {
  kind: TKind
  parse(input: ParserSourceInput): Promise<ParsedArtifact<TKind>>
}

export function normalizeTextBody(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim()
}

export function deriveTitleFromPath(filePath: string): string {
  const filename = path.basename(filePath, path.extname(filePath)).trim()
  return filename || 'untitled'
}

export function deriveTitleFromFirstLine(content: string): string {
  const firstNonEmptyLine = normalizeTextBody(content)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  return firstNonEmptyLine || 'untitled'
}

export function deriveTitleFromText(content: string, filePath: string): string {
  const firstLineTitle = deriveTitleFromFirstLine(content)
  return firstLineTitle === 'untitled' ? deriveTitleFromPath(filePath) : firstLineTitle
}

export function createParsedArtifact<TKind extends SourceKind>(input: {
  kind: TKind
  sourceId: string
  path: string
  body: string
  title: string
  parser: string
  parsedAt?: string
  metadata?: Record<string, string | number | boolean | null>
}): ParsedArtifact<TKind> {
  const parsedAt = input.parsedAt ?? new Date().toISOString()
  const body = normalizeTextBody(input.body)
  const title = input.title.trim() || deriveTitleFromPath(input.path)

  return {
    id: input.sourceId,
    sourceKind: input.kind,
    sourceRef: input.path,
    title,
    content: body,
    summary: body.slice(0, 280),
    tags: [],
    metadata: {
      sourceId: input.sourceId,
      path: input.path,
      parser: input.parser,
      ...input.metadata,
    },
    createdAt: parsedAt,
    updatedAt: parsedAt,
  }
}
