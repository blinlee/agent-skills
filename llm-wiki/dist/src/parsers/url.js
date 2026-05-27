import { createParsedArtifact } from './base.js';
export async function parseUrlSource(input, fetchCleanedContent) {
    const cleanedContent = await fetchCleanedContent(input.url);
    const artifact = createParsedArtifact({
        kind: 'url',
        sourceId: input.sourceId,
        path: input.url,
        title: cleanedContent.title,
        body: cleanedContent.body,
        parser: 'url',
        parsedAt: input.parsedAt,
    });
    return {
        ...artifact,
        metadata: {
            ...artifact.metadata,
            url: input.url,
        },
    };
}
