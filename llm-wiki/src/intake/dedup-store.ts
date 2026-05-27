import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SourceKind } from '../types'

export type OutputPageSnapshot = {
  filePath: string
  title: string
  body: string
  indexEntry: string | null
}

export type SourceOutputManifest = {
  pageFiles: string[]
  indexEntries: string[]
  reviewFiles?: string[]
  pageSnapshots?: OutputPageSnapshot[]
}

export type DedupEntry = {
  identity: string
  lastFingerprint: string
  sourceKind: SourceKind
  lastSuccessfulJobId: string | null
  lastCompiledAt: string | null
  lastOutputManifest: SourceOutputManifest | null
}

type DedupManifest = {
  entries: Record<string, DedupEntry>
}

export type DedupDecision = {
  action: 'compile' | 'skip' | 'recompile'
  reason: 'first-seen' | 'unchanged' | 'changed'
}

export type DedupStore = {
  get(identity: string): Promise<DedupEntry | null>
  list(): Promise<DedupEntry[]>
  shouldCompile(input: { identity: string; sourceKind: SourceKind; fingerprint: string }): Promise<DedupDecision>
  recordSuccess(input: {
    identity: string
    sourceKind: SourceKind
    fingerprint: string
    jobId: string
    compiledAt?: string
    outputManifest?: SourceOutputManifest | null
  }): Promise<DedupEntry>
}

async function readManifest(manifestPath: string): Promise<DedupManifest> {
  try {
    const raw = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<DedupManifest>
    return {
      entries: Object.fromEntries(
        Object.entries(parsed.entries ?? {}).map(([identity, entry]) => [
          identity,
          {
            ...entry,
            lastOutputManifest: entry?.lastOutputManifest
              ? {
                  ...entry.lastOutputManifest,
                  reviewFiles: entry.lastOutputManifest.reviewFiles ?? [],
                  pageSnapshots: entry.lastOutputManifest.pageSnapshots ?? [],
                }
              : null,
          },
        ]),
      ),
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: {} }
    }

    throw error
  }
}

const manifestWriteQueues = new Map<string, Promise<void>>()

async function writeManifest(manifestPath: string, manifest: DedupManifest): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true })
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8')
  await rename(tempPath, manifestPath)
}

export function createDedupStore(manifestPath: string): DedupStore {
  const manifestKey = path.resolve(manifestPath)

  const withWriteLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previousTail = manifestWriteQueues.get(manifestKey) ?? Promise.resolve()
    const result = previousTail.catch(() => undefined).then(operation)
    const nextTail = result.then(() => undefined, () => undefined)

    manifestWriteQueues.set(manifestKey, nextTail)

    try {
      return await result
    } finally {
      if (manifestWriteQueues.get(manifestKey) === nextTail) {
        manifestWriteQueues.delete(manifestKey)
      }
    }
  }

  const awaitPendingWrites = async () => {
    await (manifestWriteQueues.get(manifestKey) ?? Promise.resolve())
  }

  const get: DedupStore['get'] = async (identity) => {
    await awaitPendingWrites()
    const manifest = await readManifest(manifestPath)
    return manifest.entries[identity] ?? null
  }

  return {
    get,
    async list() {
      await awaitPendingWrites()
      const manifest = await readManifest(manifestPath)
      return Object.values(manifest.entries)
    },
    async shouldCompile(input) {
      const existing = await get(input.identity)

      if (!existing) {
        return { action: 'compile', reason: 'first-seen' }
      }

      if (existing.lastFingerprint === input.fingerprint && existing.sourceKind === input.sourceKind) {
        return { action: 'skip', reason: 'unchanged' }
      }

      return { action: 'recompile', reason: 'changed' }
    },
    async recordSuccess(input) {
      return withWriteLock(async () => {
        const manifest = await readManifest(manifestPath)
        const nextEntry: DedupEntry = {
          identity: input.identity,
          lastFingerprint: input.fingerprint,
          sourceKind: input.sourceKind,
          lastSuccessfulJobId: input.jobId,
          lastCompiledAt: input.compiledAt ?? new Date().toISOString(),
          lastOutputManifest: input.outputManifest
            ? {
                ...input.outputManifest,
                reviewFiles: input.outputManifest.reviewFiles ?? [],
                pageSnapshots: input.outputManifest.pageSnapshots ?? [],
              }
            : null,
        }

        manifest.entries[input.identity] = nextEntry
        await writeManifest(manifestPath, manifest)
        return nextEntry
      })
    },
  }
}
