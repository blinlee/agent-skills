import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { KnowledgeGenerationResult } from '../compile/generation.js'
import type { DedupEntry, OutputPageSnapshot } from '../intake/dedup-store.js'
import { updateWikiIndex } from '../wiki/index-log.js'
import { removeWikiPageFile, restoreWikiPageSnapshot } from '../wiki/page-writer.js'

type SemanticPageSection = 'entities' | 'concepts' | 'syntheses'
type SemanticPageRewrite = { section: SemanticPageSection; fromSlug: string; toSlug: string; title: string }

type DerivedPageOwner = {
  entry: DedupEntry
  snapshot: OutputPageSnapshot
}

export async function resolveSemanticPageOwnership(input: {
  knowledgeRoot: string
  generation: KnowledgeGenerationResult
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<KnowledgeGenerationResult> {
  const [entityPages, entityRewrites] = await resolveOwnedSemanticPages({
    knowledgeRoot: input.knowledgeRoot,
    section: 'entities',
    pages: input.generation.entityPages,
    sourceSlug: input.generation.sourcePage.slug,
    previousOutputManifest: input.previousOutputManifest,
  })
  const [conceptPages, conceptRewrites] = await resolveOwnedSemanticPages({
    knowledgeRoot: input.knowledgeRoot,
    section: 'concepts',
    pages: input.generation.conceptPages,
    sourceSlug: input.generation.sourcePage.slug,
    previousOutputManifest: input.previousOutputManifest,
  })
  const [synthesisPages, synthesisRewrites] = await resolveOwnedSemanticPages({
    knowledgeRoot: input.knowledgeRoot,
    section: 'syntheses',
    pages: input.generation.synthesisPages,
    sourceSlug: input.generation.sourcePage.slug,
    previousOutputManifest: input.previousOutputManifest,
  })
  const rewrites = [...entityRewrites, ...conceptRewrites, ...synthesisRewrites]

  return {
    ...input.generation,
    sourcePage: {
      ...input.generation.sourcePage,
      body: rewriteSemanticLinks(input.generation.sourcePage.body, rewrites),
    },
    entityPages,
    conceptPages,
    synthesisPages,
    indexMutations: input.generation.indexMutations.map((mutation) => ({
      ...mutation,
      value: rewriteSemanticLinks(mutation.value, rewrites),
    })),
  }
}

export function buildReviewRelatedPages(generation: KnowledgeGenerationResult): string[] {
  return [
    `sources/${generation.sourcePage.slug}`,
    ...generation.entityPages.map((page) => `entities/${page.slug}`),
    ...generation.conceptPages.map((page) => `concepts/${page.slug}`),
    ...generation.synthesisPages.map((page) => `syntheses/${page.slug}`),
  ]
}

export async function reconcileStaleDerivedOutputs(input: {
  knowledgeRoot: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
  currentOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>
  otherEntries: DedupEntry[]
}): Promise<{ writtenFiles: string[] }> {
  const previousManifest = input.previousOutputManifest
  if (!previousManifest) {
    return { writtenFiles: [] }
  }

  const staleDerivedFiles = collectStaleDerivedFiles(previousManifest, input.currentOutputManifest)

  const retainedIndexEntries = new Set(
    input.otherEntries.flatMap((entry) => entry.lastOutputManifest?.indexEntries ?? []),
  )
  const indexEntriesToAdd = new Set<string>()
  const indexEntriesToRemove = new Set<string>()
  const retainedHumanEditedFiles = new Set<string>()
  const writtenFiles: string[] = []
  for (const filePath of staleDerivedFiles) {
    const remainingOwners = await collectDerivedPageOwners({
      entries: input.otherEntries,
      filePath,
    })

    if (remainingOwners.length === 0) {
      if (!(await isManifestOwnedSemanticPageUnmodified({
        knowledgeRoot: input.knowledgeRoot,
        relativePath: filePath,
        previousOutputManifest: previousManifest,
      }))) {
        retainedHumanEditedFiles.add(filePath)
        continue
      }
      await removeWikiPageFile(input.knowledgeRoot, filePath)
      writtenFiles.push(path.join(path.resolve(input.knowledgeRoot), filePath))
      continue
    }

    const survivor = pickMostRecentSnapshotOwner(remainingOwners)
    writtenFiles.push(await restoreWikiPageSnapshot(input.knowledgeRoot, survivor.snapshot))

    if (survivor.snapshot.indexEntry) {
      indexEntriesToAdd.add(survivor.snapshot.indexEntry)
    }
  }

  const staleIndexEntries = previousManifest.indexEntries.filter(
    (entry) => {
      const targetFile = semanticIndexEntryTargetFile(entry)
      return !input.currentOutputManifest.indexEntries.includes(entry)
        && !isSourceOwnedIndexEntry(entry)
        && !(targetFile && retainedHumanEditedFiles.has(targetFile))
    },
  )

  for (const entry of staleIndexEntries) {
    if (!retainedIndexEntries.has(entry)) {
      indexEntriesToRemove.add(entry)
    }
  }

  if (indexEntriesToAdd.size > 0 || indexEntriesToRemove.size > 0) {
    writtenFiles.push(await updateWikiIndex(input.knowledgeRoot, {
      addEntries: [...indexEntriesToAdd],
      removeEntries: [...indexEntriesToRemove],
    }))
  }

  return {
    writtenFiles: [...new Set(writtenFiles)],
  }
}

async function resolveOwnedSemanticPages(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  pages: KnowledgeGenerationResult['entityPages']
  sourceSlug: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<[KnowledgeGenerationResult['entityPages'], SemanticPageRewrite[]]> {
  const resolvedPages: KnowledgeGenerationResult['entityPages'] = []
  const rewrites: SemanticPageRewrite[] = []
  const reservedSlugs = new Set(input.pages.map((page) => page.slug))

  for (const page of input.pages) {
    const owned = await isPageWritableByCurrentSource({
      knowledgeRoot: input.knowledgeRoot,
      section: input.section,
      slug: page.slug,
      previousOutputManifest: input.previousOutputManifest,
    })
    if (owned) {
      resolvedPages.push(page)
      continue
    }

    const nextSlug = await nextSourceScopedSemanticSlug({
      knowledgeRoot: input.knowledgeRoot,
      section: input.section,
      baseSlug: page.slug,
      sourceSlug: input.sourceSlug,
      previousOutputManifest: input.previousOutputManifest,
      reservedSlugs,
    })
    reservedSlugs.add(nextSlug)
    resolvedPages.push({ ...page, slug: nextSlug })
    rewrites.push({ section: input.section, fromSlug: page.slug, toSlug: nextSlug, title: page.title })
  }

  return [resolvedPages, rewrites]
}

async function isPageWritableByCurrentSource(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  slug: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<boolean> {
  const relativePath = `wiki/${input.section}/${input.slug}.md`
  if (manifestOwnsPage(input.previousOutputManifest, relativePath)) {
    return isManifestOwnedSemanticPageUnmodified({
      knowledgeRoot: input.knowledgeRoot,
      relativePath,
      previousOutputManifest: input.previousOutputManifest,
    })
  }
  if (!(await fileExists(path.join(input.knowledgeRoot, relativePath)))) {
    return true
  }
  if (input.section === 'syntheses') {
    return false
  }
  return isManagedSemanticPage({
    knowledgeRoot: input.knowledgeRoot,
    section: input.section,
    slug: input.slug,
  })
}

async function isManagedSemanticPage(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  slug: string
}): Promise<boolean> {
  let markdown: string
  try {
    markdown = await readFile(path.join(input.knowledgeRoot, 'wiki', input.section, `${input.slug}.md`), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }

  const typeBySection = {
    entities: 'entity',
    concepts: 'concept',
    syntheses: 'synthesis',
  } as const
  return hasManagedSemanticFrontmatter(markdown, typeBySection[input.section])
}

async function nextSourceScopedSemanticSlug(input: {
  knowledgeRoot: string
  section: SemanticPageSection
  baseSlug: string
  sourceSlug: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
  reservedSlugs: Set<string>
}): Promise<string> {
  const base = `${input.baseSlug}-${input.sourceSlug}`
  for (let counter = 1; counter < 100; counter += 1) {
    const slug = counter === 1 ? base : `${base}-${counter}`
    const relativePath = `wiki/${input.section}/${slug}.md`
    if (input.reservedSlugs.has(slug)) {
      continue
    }
    if (manifestOwnsPage(input.previousOutputManifest, relativePath)) {
      if (await isManifestOwnedSemanticPageUnmodified({
        knowledgeRoot: input.knowledgeRoot,
        relativePath,
        previousOutputManifest: input.previousOutputManifest,
      })) {
        return slug
      }
      continue
    }
    if (!(await fileExists(path.join(input.knowledgeRoot, relativePath)))) {
      return slug
    }
  }
  throw new Error(`Unable to choose non-conflicting semantic page slug for ${input.section}/${input.baseSlug}`)
}

function collectStaleDerivedFiles(
  previousOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>,
  currentOutputManifest: NonNullable<DedupEntry['lastOutputManifest']>,
): string[] {
  const previousDerivedFiles = new Set<string>([
    ...previousOutputManifest.pageFiles.filter(isDerivedWikiPage),
    ...previousOutputManifest.pageSnapshots.map((snapshot) => snapshot.filePath).filter(isDerivedWikiPage),
  ])

  return [...previousDerivedFiles].filter((filePath) => !currentOutputManifest.pageFiles.includes(filePath))
}

async function collectDerivedPageOwners(input: {
  entries: DedupEntry[]
  filePath: string
}): Promise<DerivedPageOwner[]> {
  const owners = await Promise.all(input.entries.map(async (entry) => {
    const snapshots = entry.lastOutputManifest?.pageSnapshots ?? []

    return snapshots
      .filter((snapshot) => snapshot.filePath === input.filePath)
      .map((snapshot) => ({ entry, snapshot }))
  }))

  return owners.flat()
}

function pickMostRecentSnapshotOwner(
  owners: DerivedPageOwner[],
): DerivedPageOwner {
  return [...owners].sort((left, right) => compareCompiledAt(right.entry.lastCompiledAt, left.entry.lastCompiledAt))[0]
}

function compareCompiledAt(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : Number.NEGATIVE_INFINITY
  const rightTime = right ? Date.parse(right) : Number.NEGATIVE_INFINITY
  return leftTime - rightTime
}

function manifestOwnsPage(manifest: DedupEntry['lastOutputManifest'], relativePath: string): boolean {
  return Boolean(
    manifest?.pageFiles.includes(relativePath)
    || manifest?.pageSnapshots.some((snapshot) => snapshot.filePath === relativePath),
  )
}

function hasManagedSemanticFrontmatter(markdown: string, type: 'entity' | 'concept' | 'synthesis'): boolean {
  return new RegExp(`^---\\n[\\s\\S]*\\ntype: ${JSON.stringify(type)}\\n[\\s\\S]*\\n---\\n?`, 'u').test(markdown)
}

async function isManifestOwnedSemanticPageUnmodified(input: {
  knowledgeRoot: string
  relativePath: string
  previousOutputManifest: DedupEntry['lastOutputManifest']
}): Promise<boolean> {
  const snapshot = input.previousOutputManifest?.pageSnapshots.find((candidate) => candidate.filePath === input.relativePath)
  if (!snapshot) {
    return false
  }

  let currentMarkdown: string
  try {
    currentMarkdown = await readFile(path.join(input.knowledgeRoot, input.relativePath), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true
    }
    throw error
  }

  if (snapshot.body.trimStart().startsWith('---\n')) {
    return currentMarkdown.trimEnd() === snapshot.body.trimEnd()
  }

  return stripWikiFrontmatter(currentMarkdown).trimEnd() === snapshot.body.trimEnd()
}

function stripWikiFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) {
    return markdown
  }
  const end = markdown.indexOf('\n---\n', 4)
  if (end < 0) {
    return markdown
  }
  return markdown.slice(end + '\n---\n'.length)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function rewriteSemanticLinks(
  value: string,
  rewrites: SemanticPageRewrite[],
): string {
  return rewrites.reduce((current, rewrite) => {
    const from = `[[${rewrite.section}/${rewrite.fromSlug}|${rewrite.title}]]`
    const to = `[[${rewrite.section}/${rewrite.toSlug}|${rewrite.title}]]`
    return current.split(from).join(to)
  }, value)
}

function isDerivedWikiPage(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('wiki/entities/') || normalized.startsWith('wiki/concepts/') || normalized.startsWith('wiki/syntheses/')
}

function isSourceOwnedIndexEntry(entry: string): boolean {
  return /^[-*]\s+\[\[sources\/[^|\]]+\|[^\]]+\]\]$/.test(entry.trim())
}

function semanticIndexEntryTargetFile(entry: string): string | null {
  const match = entry.trim().match(/^[-*]\s+\[\[((?:entities|concepts|syntheses)\/[^|\]]+)\|[^\]]+\]\]$/)
  return match ? `wiki/${match[1]}.md` : null
}
