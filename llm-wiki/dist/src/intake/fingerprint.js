import { createHash } from 'node:crypto';
function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function hashContent(content) {
    return sha256Hex(content);
}
export async function hashFileLike(input) {
    if (ArrayBuffer.isView(input)) {
        return sha256Hex(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    }
    return sha256Hex(new Uint8Array(input));
}
export function hashSourceMetadata(metadata) {
    const normalizedEntries = Object.entries(metadata)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return sha256Hex(JSON.stringify(normalizedEntries));
}
export function hashParsedArtifactForDedup(artifact) {
    return sha256Hex(JSON.stringify({
        sourceKind: artifact.sourceKind,
        sourceRef: artifact.sourceRef,
        title: artifact.title,
        content: artifact.content,
        metadata: Object.entries(artifact.metadata).sort(([left], [right]) => left.localeCompare(right)),
    }));
}
