import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type SourceLinkTarget = {
  slug: string
  title: string
}

export type ApplySourceSemanticLinksInput = {
  knowledgeRoot: string
  source: SourceLinkTarget
}

export type ApplySourceSemanticLinksResult = {
  writtenFiles: string[]
  relatedTargets: SourceLinkTarget[]
}

export type PruneSourceSemanticLinksResult = {
  writtenFiles: string[]
}

const LINK_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'using', 'use', 'with',
  'complete', 'official', 'documentation', 'document', 'docs', 'reference', 'overview', 'guide', 'saved', 'date', 'source', 'author', 'title',
])

export async function applySourceSemanticLinks(
  input: ApplySourceSemanticLinksInput,
): Promise<ApplySourceSemanticLinksResult> {
  const root = path.resolve(input.knowledgeRoot)
  const sourceDirectory = path.join(root, 'wiki', 'sources')
  const currentPath = path.join(sourceDirectory, `${input.source.slug}.md`)
  const currentContent = await readFile(currentPath, 'utf8')
  const existingSources = await listExistingSourcePages(sourceDirectory, input.source.slug)
  const relatedTargets = rankRelatedSources(
    { ...input.source, content: currentContent },
    existingSources,
  ).slice(0, 3)

  if (relatedTargets.length === 0) {
    return { writtenFiles: [], relatedTargets: [] }
  }

  const writtenFiles = new Set<string>()
  const currentLinks = relatedTargets.map((target) => formatSourceLink(target))
  const updatedCurrent = appendSectionEntries(currentContent, 'Related wiki pages', currentLinks)
  if (updatedCurrent !== currentContent) {
    await writeFile(currentPath, updatedCurrent, 'utf8')
    writtenFiles.add(currentPath)
  }

  for (const target of relatedTargets) {
    const targetPath = path.join(sourceDirectory, `${target.slug}.md`)
    const targetContent = await readFile(targetPath, 'utf8')
    const updatedTarget = appendSectionEntries(targetContent, 'Related wiki pages', [formatSourceLink(input.source)])
    if (updatedTarget !== targetContent) {
      await writeFile(targetPath, updatedTarget, 'utf8')
      writtenFiles.add(targetPath)
    }
  }

  return {
    writtenFiles: [...writtenFiles].sort((left, right) => left.localeCompare(right)),
    relatedTargets,
  }
}

export async function pruneMissingSourceSemanticLinks(
  knowledgeRoot: string,
): Promise<PruneSourceSemanticLinksResult> {
  const root = path.resolve(knowledgeRoot)
  const sourceDirectory = path.join(root, 'wiki', 'sources')
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  const sourceSlugs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.basename(entry.name, '.md'))
  const existingSourceSlugs = new Set(sourceSlugs)
  const writtenFiles: string[] = []

  for (const slug of sourceSlugs) {
    const filePath = path.join(sourceDirectory, `${slug}.md`)
    const content = await readFile(filePath, 'utf8')
    const updated = pruneRelatedWikiPagesSection(content, slug, existingSourceSlugs)

    if (updated !== content) {
      await writeFile(filePath, updated, 'utf8')
      writtenFiles.push(filePath)
    }
  }

  return {
    writtenFiles: writtenFiles.sort((left, right) => left.localeCompare(right)),
  }
}

async function listExistingSourcePages(sourceDirectory: string, currentSlug: string): Promise<Array<SourceLinkTarget & { content: string }>> {
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  const pages: Array<SourceLinkTarget & { content: string }> = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue
    }

    const slug = path.basename(entry.name, '.md')
    if (slug === currentSlug) {
      continue
    }

    const filePath = path.join(sourceDirectory, entry.name)
    const content = await readFile(filePath, 'utf8')
    pages.push({
      slug,
      title: extractTitle(content) ?? titleFromSlug(slug),
      content,
    })
  }

  return pages
}

function pruneRelatedWikiPagesSection(content: string, currentSlug: string, existingSourceSlugs: Set<string>): string {
  const lines = content.trimEnd().split('\n')
  const headingIndex = lines.findIndex((line) => line.trim() === '## Related wiki pages')

  if (headingIndex === -1) {
    return content
  }

  const nextHeadingIndex = lines.findIndex((line, index) => index > headingIndex && /^##\s+/.test(line))
  const sectionEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex
  const retainedSectionLines = lines
    .slice(headingIndex + 1, sectionEnd)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => {
      const linkedSourceSlugs = [...line.matchAll(/\[\[sources\/([^|\]]+)/g)].map((match) => match[1])

      if (linkedSourceSlugs.length === 0) {
        return false
      }

      return linkedSourceSlugs.every((slug) => slug !== currentSlug && existingSourceSlugs.has(slug))
    })

  const updatedLines = retainedSectionLines.length === 0
    ? [
        ...trimTrailingBlankLines(lines.slice(0, headingIndex)),
        ...lines.slice(sectionEnd),
      ]
    : [
        ...lines.slice(0, headingIndex + 1),
        ...retainedSectionLines,
        ...lines.slice(sectionEnd),
      ]

  return `${trimTrailingBlankLines(updatedLines).join('\n')}\n`
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines]
  while (next.length > 0 && next[next.length - 1].trim() === '') {
    next.pop()
  }
  return next
}

function rankRelatedSources(
  current: SourceLinkTarget & { content: string },
  candidates: Array<SourceLinkTarget & { content: string }>,
): SourceLinkTarget[] {
  const currentTerms = extractKeyTerms(`${current.title}\n${current.content}`)

  return candidates
    .map((candidate) => {
      const candidateTerms = extractKeyTerms(`${candidate.title}\n${candidate.content}`)
      const overlap = [...currentTerms].filter((term) => candidateTerms.has(term))
      const titleOverlap = [...extractKeyTerms(current.title)].filter((term) => extractKeyTerms(candidate.title).has(term))
      const score = overlap.length + titleOverlap.length
      return { candidate, score, overlap }
    })
    .filter((entry) => entry.score >= 3 || entry.overlap.some((term) => isStrongDomainTerm(term)))
    .sort((left, right) => right.score - left.score || left.candidate.slug.localeCompare(right.candidate.slug))
    .map((entry) => ({ slug: entry.candidate.slug, title: entry.candidate.title }))
}

function extractKeyTerms(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !LINK_STOP_WORDS.has(token))
    .map(stemToken)

  return new Set(tokens)
}

function stemToken(token: string): string {
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`
  if (token.endsWith('es') && token.length > 5) return token.slice(0, -2)
  if (token.endsWith('s') && token.length > 4) return token.slice(0, -1)
  return token
}

function isStrongDomainTerm(term: string): boolean {
  return term.length >= 7 || /[0-9]/.test(term)
}

function appendSectionEntries(content: string, heading: string, entries: string[]): string {
  const normalizedEntries = [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))]
  if (normalizedEntries.length === 0) {
    return content
  }

  const lines = content.trimEnd().split('\n')
  const headingLine = `## ${heading}`
  const headingIndex = lines.findIndex((line) => line.trim() === headingLine)

  if (headingIndex === -1) {
    return `${lines.join('\n')}\n\n${headingLine}\n${normalizedEntries.join('\n')}\n`
  }

  const nextHeadingIndex = lines.findIndex((line, index) => index > headingIndex && /^##\s+/.test(line))
  const sectionEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex
  const existing = new Set(lines.slice(headingIndex + 1, sectionEnd).map((line) => line.trim()))
  const additions = normalizedEntries.filter((entry) => !existing.has(entry))

  if (additions.length === 0) {
    return content
  }

  const updated = [
    ...lines.slice(0, sectionEnd),
    ...additions,
    ...lines.slice(sectionEnd),
  ]
  return `${updated.join('\n')}\n`
}

function formatSourceLink(target: SourceLinkTarget): string {
  return `- [[sources/${target.slug}|${target.title}]]`
}

function extractTitle(content: string): string | null {
  const frontmatterTitle = content.match(/^---\n[\s\S]*?^title:\s*(.+)$/m)?.[1]
  if (frontmatterTitle) {
    try {
      const parsed = JSON.parse(frontmatterTitle.trim()) as unknown
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim()
    } catch {
      return frontmatterTitle.trim().replace(/^["']|["']$/g, '')
    }
  }

  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null
}

function titleFromSlug(slug: string): string {
  return slug.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
