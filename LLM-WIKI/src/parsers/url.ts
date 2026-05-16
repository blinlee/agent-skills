import { createParsedArtifact, type ParsedArtifact } from './base'

export type UrlSourceInput = {
  sourceId: string
  url: string
  parsedAt?: string
}

export type CleanedUrlContent = {
  title: string
  body: string
}

export type FetchCleanedUrlContent = (url: string) => Promise<CleanedUrlContent>

export async function parseUrlSource(
  input: UrlSourceInput,
  fetchCleanedContent: FetchCleanedUrlContent,
): Promise<ParsedArtifact<'url'>> {
  const cleanedContent = await fetchCleanedContent(input.url)
  const artifact = createParsedArtifact({
    kind: 'url',
    sourceId: input.sourceId,
    path: input.url,
    title: cleanedContent.title,
    body: cleanedContent.body,
    parser: 'url',
    parsedAt: input.parsedAt,
  })

  return {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      url: input.url,
    },
  }
}
