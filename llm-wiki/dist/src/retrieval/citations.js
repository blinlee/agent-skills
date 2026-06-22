export function buildCitation(chunk) {
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
    };
}
export function buildExcerpt(markdown) {
    return compact(markdown.replace(/^# .*$/m, '')).slice(0, 280);
}
export function compact(value) {
    return value.replace(/\s+/g, ' ').trim();
}
