import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgePagePayload, SynthesisSuggestionPayload } from '../compile/generation.js'
import type { OutputPageSnapshot } from '../intake/dedup-store.js'
import { appendWikiLog, updateWikiIndex } from './index-log.js'

export type KnowledgeOutputManifest = {
  pageFiles: string[]
  indexEntries: string[]
  pageSnapshots?: OutputPageSnapshot[]
}

export type BuildKnowledgeOutputManifestInput = {
  sourcePage: Pick<KnowledgePagePayload, 'slug' | 'title' | 'body'>
  entityPages: Array<Pick<KnowledgePagePayload, 'slug' | 'title' | 'body'>>
  conceptPages: Array<Pick<KnowledgePagePayload, 'slug' | 'title' | 'body'>>
  indexEntries: string[]
}

export type WriteKnowledgeChangesInput = BuildKnowledgeOutputManifestInput & {
  knowledgeRoot: string
  synthesisSuggestions: Array<Pick<SynthesisSuggestionPayload, 'slug' | 'title' | 'body'>>
  logEntry: string
  previousOutputManifest?: KnowledgeOutputManifest | null
}

export type WriteKnowledgeChangesResult = {
  writtenFiles: string[]
  outputManifest: KnowledgeOutputManifest
}

export async function writeKnowledgeChanges(input: WriteKnowledgeChangesInput): Promise<WriteKnowledgeChangesResult> {
  const root = path.resolve(input.knowledgeRoot)
  const writtenFiles: string[] = []
  const outputManifest = buildKnowledgeOutputManifest(input)

  await writeWikiPage(root, 'sources', input.sourcePage)
  writtenFiles.push(path.join(root, outputManifest.pageFiles[0]))

  for (const page of input.entityPages) {
    await writeWikiPage(root, 'entities', page)
    writtenFiles.push(path.join(root, 'wiki', 'entities', `${page.slug}.md`))
  }

  for (const page of input.conceptPages) {
    await writeWikiPage(root, 'concepts', page)
    writtenFiles.push(path.join(root, 'wiki', 'concepts', `${page.slug}.md`))
  }

  await removeStalePages(root, input.previousOutputManifest, outputManifest)

  writtenFiles.push(
    await updateWikiIndex(root, {
      addEntries: outputManifest.indexEntries,
      removeEntries: input.previousOutputManifest?.indexEntries.filter(
        (entry) => !outputManifest.indexEntries.includes(entry) && isSourceOwnedIndexEntry(entry),
      ) ?? [],
    }),
  )
  writtenFiles.push(await appendWikiLog(root, input.logEntry))

  return {
    writtenFiles,
    outputManifest,
  }
}

type WritablePage = {
  slug: string
  title: string
  body: string
  artifactId?: string
  topics?: string[]
}

export function buildKnowledgeOutputManifest(input: BuildKnowledgeOutputManifestInput): KnowledgeOutputManifest {
  const currentPageFiles = [
    path.join('wiki', 'sources', `${input.sourcePage.slug}.md`).replace(/\\/g, '/'),
    ...input.entityPages.map((page) => path.join('wiki', 'entities', `${page.slug}.md`).replace(/\\/g, '/')),
    ...input.conceptPages.map((page) => path.join('wiki', 'concepts', `${page.slug}.md`).replace(/\\/g, '/')),
  ]

  return {
    pageFiles: currentPageFiles,
    indexEntries: normalizeEntries(input.indexEntries),
    pageSnapshots: buildPageSnapshots(input, currentPageFiles),
  }
}

export async function restoreWikiPageSnapshot(knowledgeRoot: string, snapshot: OutputPageSnapshot): Promise<string> {
  validateRelativeWikiPagePath(snapshot.filePath)
  const filePath = path.join(path.resolve(knowledgeRoot), snapshot.filePath)
  await atomicWriteFile(filePath, formatPageMarkdown({
    slug: path.basename(snapshot.filePath, '.md'),
    title: snapshot.title,
    body: snapshot.body,
  }, sectionFromSnapshotPath(snapshot.filePath)))
  return filePath
}

export async function removeWikiPageFile(knowledgeRoot: string, relativeFilePath: string): Promise<void> {
  validateRelativeWikiPagePath(relativeFilePath)
  await rm(path.join(path.resolve(knowledgeRoot), relativeFilePath), { force: true })
}

const SAFE_SLUG_PATTERN = /^[a-z0-9-]+$/

async function writeWikiPage(
  knowledgeRoot: string,
  section: 'sources' | 'entities' | 'concepts' | 'syntheses',
  page: WritablePage,
): Promise<string> {
  validateSlug(page.slug)

  const filePath = path.join(knowledgeRoot, 'wiki', section, `${page.slug}.md`)
  const markdown = formatPageMarkdown(page, section)

  await atomicWriteFile(filePath, markdown)

  return filePath
}

async function removeStalePages(
  knowledgeRoot: string,
  previousOutputManifest: KnowledgeOutputManifest | null | undefined,
  currentOutputManifest: KnowledgeOutputManifest,
): Promise<void> {
  const stalePageFiles = previousOutputManifest?.pageFiles.filter(
    (filePath) => !currentOutputManifest.pageFiles.includes(filePath) && isSourceOwnedPageFile(filePath),
  ) ?? []

  await Promise.all(stalePageFiles.map((filePath) => rm(path.join(knowledgeRoot, filePath), { force: true })))
}

// Stale cleanup is scoped to source-owned pages so shared or manually-created
// semantic pages are not deleted during a source recompile.
function isSourceOwnedPageFile(filePath: string): boolean {
  const normalizedPath = path.normalize(filePath)
  const relativeToWiki = normalizedPath.startsWith(`wiki${path.sep}`)
    ? normalizedPath.slice(`wiki${path.sep}`.length)
    : normalizedPath
  const [section] = relativeToWiki.split(path.sep)

  return section === 'sources'
}

function isSourceOwnedIndexEntry(entry: string): boolean {
  const match = entry.trim().match(/^[-*]\s+\[\[(sources\/[^|\]]+\|[^\]]+)\]\]$/)
  return Boolean(match)
}

function buildPageSnapshots(
  input: BuildKnowledgeOutputManifestInput,
  currentPageFiles: string[],
): OutputPageSnapshot[] {
  const sourceSnapshots = [{
    section: 'sources' as const,
    page: input.sourcePage,
  }]
  const entitySnapshots = input.entityPages.map((page) => ({
    section: 'entities' as const,
    page,
  }))
  const conceptSnapshots = input.conceptPages.map((page) => ({
    section: 'concepts' as const,
    page,
  }))

  return [...sourceSnapshots, ...entitySnapshots, ...conceptSnapshots].map(({ section, page }) => {
    const filePath = path.join('wiki', section, `${page.slug}.md`).replace(/\\/g, '/')
    const indexEntry = buildIndexEntry(section, page)

    return {
      filePath,
      title: page.title,
      body: page.body,
      indexEntry,
    }
  }).filter((snapshot) => currentPageFiles.includes(snapshot.filePath))
}

function buildIndexEntry(
  section: 'sources' | 'entities' | 'concepts',
  page: Pick<WritablePage, 'slug' | 'title'>,
): string {
  return `- [[${section}/${page.slug}|${page.title}]]`
}

function normalizeEntries(entries: string[]): string[] {
  return [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))]
}

function formatPageMarkdown(page: WritablePage, section: 'sources' | 'entities' | 'concepts' | 'syntheses'): string {
  const normalizedBody = page.body.trim()
  const body = normalizedBody.startsWith('# ') || normalizedBody.startsWith('---\n')
    ? normalizedBody
    : [`# ${page.title}`, '', normalizedBody].join('\n').trimEnd()

  if (body.startsWith('---\n')) {
    return `${body}\n`
  }

  return [formatWikiFrontmatter(page, section), body].join('\n').trimEnd() + '\n'
}

function formatWikiFrontmatter(page: WritablePage, section: 'sources' | 'entities' | 'concepts' | 'syntheses'): string {
  const now = new Date().toISOString()
  const typeBySection = {
    sources: 'source',
    entities: 'entity',
    concepts: 'concept',
    syntheses: 'synthesis',
  } as const
  const sources = page.artifactId ? [page.artifactId] : []
  const tags = page.topics ?? []

  return [
    '---',
    `title: ${JSON.stringify(page.title)}`,
    `created: ${JSON.stringify(now)}`,
    `updated: ${JSON.stringify(now)}`,
    `type: ${JSON.stringify(typeBySection[section])}`,
    `tags: ${JSON.stringify(tags)}`,
    `sources: ${JSON.stringify(sources)}`,
    'confidence: "medium"',
    'contested: false',
    '---',
  ].join('\n')
}

function sectionFromSnapshotPath(filePath: string): 'sources' | 'entities' | 'concepts' | 'syntheses' {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('wiki/entities/')) return 'entities'
  if (normalized.startsWith('wiki/concepts/')) return 'concepts'
  if (normalized.startsWith('wiki/syntheses/')) return 'syntheses'
  return 'sources'
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}

function validateRelativeWikiPagePath(relativeFilePath: string): void {
  const normalized = path.posix.normalize(relativeFilePath.replace(/\\/g, '/'))
  if (!normalized.startsWith('wiki/') || normalized.includes('../') || !normalized.endsWith('.md')) {
    throw new Error(`Invalid wiki page path: ${relativeFilePath}`)
  }
}

function validateSlug(slug: string): void {
  if (!SAFE_SLUG_PATTERN.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`)
  }
}
