import {
  createParsedArtifact,
  deriveTitleFromText,
  normalizeTextBody,
  type ParserSourceInput,
  type SourceParser,
} from './base.js'

export async function parseTextSource(input: ParserSourceInput) {
  return createParsedArtifact({
    kind: 'txt',
    sourceId: input.sourceId,
    path: input.path,
    title: deriveTitleFromText(input.content, input.path),
    body: normalizeTextBody(input.content),
    parser: 'text',
    parsedAt: input.parsedAt,
  })
}

export const textParser: SourceParser<'txt'> = {
  kind: 'txt',
  parse: parseTextSource,
}
