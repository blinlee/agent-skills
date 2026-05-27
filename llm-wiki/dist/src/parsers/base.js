import path from 'node:path';
export function normalizeTextBody(content) {
    return content.replace(/\r\n?/g, '\n').trim();
}
export function deriveTitleFromPath(filePath) {
    const filename = path.basename(filePath, path.extname(filePath)).trim();
    return filename || 'untitled';
}
export function deriveTitleFromFirstLine(content) {
    const firstNonEmptyLine = normalizeTextBody(content)
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
    return firstNonEmptyLine || 'untitled';
}
export function deriveTitleFromText(content, filePath) {
    const firstLineTitle = deriveTitleFromFirstLine(content);
    return firstLineTitle === 'untitled' ? deriveTitleFromPath(filePath) : firstLineTitle;
}
export function createParsedArtifact(input) {
    const parsedAt = input.parsedAt ?? new Date().toISOString();
    const body = normalizeTextBody(input.body);
    const title = input.title.trim() || deriveTitleFromPath(input.path);
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
    };
}
