import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseWikiPageTarget, type WikiSection, wikiSectionRank } from './sections.js'

const WIKI_LINK_RE = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g

export type IndexedPage = {
  section: WikiSection
  slug: string
  title: string
  target: string
  filePath: string
}

export type WikiLink = {
  rawTarget: string
  title: string
}

export type WikiLinkResolution =
  | { status: 'resolved'; page: IndexedPage }
  | { status: 'ambiguous'; matches: IndexedPage[] }
  | { status: 'missing' }


export async function loadIndexedPages(knowledgeRoot: string): Promise<IndexedPage[]> {
  const indexPath = path.join(path.resolve(knowledgeRoot), 'wiki', 'index.md')
  const rawIndex = await readFile(indexPath, 'utf8')
  const pages: IndexedPage[] = []
  const seenTargets = new Set<string>()

  for (const link of parseWikiLinks(rawIndex)) {
    const resolved = parseIndexedTarget(link.rawTarget)
    if (!resolved || seenTargets.has(resolved.target)) {
      continue
    }

    seenTargets.add(resolved.target)
    pages.push(buildIndexedPage(knowledgeRoot, {
      section: resolved.section,
      slug: resolved.slug,
      title: link.title,
      target: resolved.target,
    }))
  }

  return pages
}

export function parseWikiLinks(markdown: string): WikiLink[] {
  return [...markdown.matchAll(WIKI_LINK_RE)].map((match) => ({
    rawTarget: (match[1] ?? '').trim(),
    title: (match[2] ?? match[1] ?? '').trim(),
  })).filter((link) => link.rawTarget.length > 0)
}

export function parseIndexedTarget(rawTarget: string): { section: WikiSection; slug: string; target: string } | null {
  return parseWikiPageTarget(rawTarget)
}

export function buildIndexedPage(knowledgeRoot: string, input: {
  section: WikiSection
  slug: string
  title: string
  target: string
}): IndexedPage {
  return {
    ...input,
    filePath: path.join(path.resolve(knowledgeRoot), 'wiki', input.section, `${input.slug}.md`),
  }
}

export function resolveWikiLink(rawTarget: string, indexedPages: IndexedPage[]): WikiLinkResolution {
  const indexedTarget = parseIndexedTarget(rawTarget)
  if (indexedTarget) {
    const page = indexedPages.find((candidate) => candidate.target === indexedTarget.target)
    return page ? { status: 'resolved', page } : { status: 'missing' }
  }

  const normalizedTarget = rawTarget.trim().toLowerCase()
  if (!normalizedTarget) {
    return { status: 'missing' }
  }

  const matches = indexedPages
    .filter((page) => page.slug === normalizedTarget)
    .sort((left, right) => comparePageOrder(left, right) || left.target.localeCompare(right.target))

  if (matches.length === 1) {
    return { status: 'resolved', page: matches[0] }
  }

  if (matches.length > 1) {
    return { status: 'ambiguous', matches }
  }

  return { status: 'missing' }
}

export function comparePageOrder(left: IndexedPage, right: IndexedPage): number {
  return wikiSectionRank(left.section) - wikiSectionRank(right.section)
}
