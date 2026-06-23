import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DedupEntry, OutputPageSnapshot, SourceOutputManifest } from './dedup-store.js'

export type NormalizedSourceOutputManifest = SourceOutputManifest & {
  pageSnapshots: OutputPageSnapshot[]
}

export type NormalizedDedupEntry = DedupEntry & {
  lastOutputManifest: NormalizedSourceOutputManifest | null
}

export function normalizeSourceOutputManifest(manifest: SourceOutputManifest): NormalizedSourceOutputManifest {
  if (!Array.isArray(manifest.pageSnapshots)) {
    throw new Error('Invalid dedup manifest: lastOutputManifest.pageSnapshots is required. Run the manifest backfill before ingesting this root.')
  }

  return {
    ...manifest,
    reviewFiles: manifest.reviewFiles ?? [],
    pageSnapshots: manifest.pageSnapshots,
  }
}

export function normalizeDedupEntry(entry: DedupEntry): NormalizedDedupEntry {
  return {
    ...entry,
    lastStatus: entry.lastStatus ?? 'completed',
    lastOutputManifest: entry.lastOutputManifest
      ? normalizeSourceOutputManifest(entry.lastOutputManifest)
      : null,
  }
}

type LegacySourceOutputManifest = Omit<SourceOutputManifest, 'pageSnapshots'> & {
  pageSnapshots?: OutputPageSnapshot[]
}

type LegacyDedupEntry = Omit<DedupEntry, 'lastOutputManifest'> & {
  lastOutputManifest: LegacySourceOutputManifest | null
}

type LegacyDedupManifest = {
  entries?: Record<string, LegacyDedupEntry>
}

export type DedupManifestSnapshotBackfillResult = {
  manifestPath: string
  migratedEntryCount: number
}

export async function backfillDedupManifestPageSnapshots(input: {
  knowledgeRoot: string
  manifestPath: string
}): Promise<DedupManifestSnapshotBackfillResult> {
  const manifest = await readLegacyDedupManifest(input.manifestPath)
  if (!manifest) {
    return { manifestPath: input.manifestPath, migratedEntryCount: 0 }
  }

  let migratedEntryCount = 0
  const entries = manifest.entries ?? {}
  for (const entry of Object.values(entries)) {
    const outputManifest = entry.lastOutputManifest
    if (!outputManifest || Array.isArray(outputManifest.pageSnapshots)) {
      continue
    }

    outputManifest.pageSnapshots = await buildPageSnapshotsFromFiles({
      knowledgeRoot: input.knowledgeRoot,
      pageFiles: outputManifest.pageFiles,
      indexEntries: outputManifest.indexEntries,
    })
    migratedEntryCount += 1
  }

  if (migratedEntryCount > 0) {
    await atomicWriteJson(input.manifestPath, manifest)
  }

  return { manifestPath: input.manifestPath, migratedEntryCount }
}

async function readLegacyDedupManifest(manifestPath: string): Promise<LegacyDedupManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8')) as LegacyDedupManifest
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function buildPageSnapshotsFromFiles(input: {
  knowledgeRoot: string
  pageFiles: string[]
  indexEntries: string[]
}): Promise<OutputPageSnapshot[]> {
  const snapshots = await Promise.all(input.pageFiles
    .map(normalizeRelativePath)
    .filter((filePath) => /^wiki\/(sources|readings|entities|concepts)\/[^/]+\.md$/.test(filePath))
    .map(async (filePath): Promise<OutputPageSnapshot | null> => {
      try {
        const body = await readFile(path.join(input.knowledgeRoot, filePath), 'utf8')
        return {
          filePath,
          title: extractSnapshotTitle(body, filePath),
          body: body.trimEnd(),
          indexEntry: findIndexEntry(input.indexEntries, filePath),
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }
    }))

  return snapshots.filter((snapshot): snapshot is OutputPageSnapshot => snapshot !== null)
}

function extractSnapshotTitle(markdown: string, filePath: string): string {
  const frontmatterTitle = markdown.match(/^---\s*[\s\S]*?\ntitle:\s*(.+?)\n[\s\S]*?\n---/u)?.[1]
  if (frontmatterTitle) {
    try {
      const parsed = JSON.parse(frontmatterTitle.trim()) as unknown
      if (typeof parsed === 'string' && parsed.trim().length > 0) {
        return parsed.trim()
      }
    } catch {
      const trimmed = frontmatterTitle.trim().replace(/^['"]|['"]$/g, '')
      if (trimmed.length > 0) {
        return trimmed
      }
    }
  }

  const headingTitle = markdown.split(/\r?\n/u).find((line) => line.startsWith('# '))?.replace(/^#\s+/, '').trim()
  return headingTitle && headingTitle.length > 0 ? headingTitle : path.basename(filePath, '.md')
}

function findIndexEntry(indexEntries: string[], filePath: string): string | null {
  const target = filePath.replace(/^wiki\//u, '').replace(/\.md$/u, '')
  return indexEntries.find((entry) => entry.includes(`[[${target}|`)) ?? null
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8')
  await rename(tempPath, filePath)
}
