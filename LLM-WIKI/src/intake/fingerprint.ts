import { createHash } from 'node:crypto'
import type { NormalizedArtifact } from '../types'

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashContent(content: string): string {
  return sha256Hex(content)
}

export async function hashFileLike(input: ArrayBuffer | ArrayBufferView): Promise<string> {
  if (ArrayBuffer.isView(input)) {
    return sha256Hex(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  }

  return sha256Hex(new Uint8Array(input))
}

export function hashSourceMetadata(metadata: Record<string, string | number | boolean | null | undefined>): string {
  const normalizedEntries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))

  return sha256Hex(JSON.stringify(normalizedEntries))
}

export function hashParsedArtifactForDedup(
  artifact: Pick<NormalizedArtifact, 'sourceKind' | 'sourceRef' | 'title' | 'content' | 'metadata'>,
): string {
  return sha256Hex(JSON.stringify({
    sourceKind: artifact.sourceKind,
    sourceRef: artifact.sourceRef,
    title: artifact.title,
    content: artifact.content,
    metadata: Object.entries(artifact.metadata).sort(([left], [right]) => left.localeCompare(right)),
  }))
}
