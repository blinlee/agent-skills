import { createParsedArtifact, deriveTitleFromText, normalizeTextBody, } from './base.js';
export async function parseTextSource(input) {
    return createParsedArtifact({
        kind: 'txt',
        sourceId: input.sourceId,
        path: input.path,
        title: deriveTitleFromText(input.content, input.path),
        body: normalizeTextBody(input.content),
        parser: 'text',
        parsedAt: input.parsedAt,
    });
}
export const textParser = {
    kind: 'txt',
    parse: parseTextSource,
};
