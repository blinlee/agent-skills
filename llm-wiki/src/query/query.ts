import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appendWikiLog } from '../wiki/index-log.js'
import { parseWikiPageTarget, type WikiSection, wikiSectionRank } from '../wiki/sections.js'

const STOP_WORDS = new Set(['what', 'is', 'the', 'a', 'an', 'for', 'to', 'of', 'and', 'in', 'on', 'from', 'with', 'about', 'summarize', 'summary', 'new'])
const WIKI_LINK_RE = /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g
const OVERVIEW_PATTERNS = [
  /summari[sz]e\s+what\s+has\s+been\s+(?:ingested|indexed|imported)/i,
  /what\s+has\s+been\s+(?:ingested|indexed|imported)/i,
  /what\s+was\s+(?:ingested|indexed|imported)/i,
  /\boverview\b/i,
  /what\s+is\s+in\s+the\s+wiki/i,
] as const

type IndexedPage = {
  section: WikiSection
  slug: string
  title: string
  target: string
  filePath: string
}

type WikiLink = {
  rawTarget: string
  title: string
}

type QuerySelectionMode = 'matched' | 'overview' | 'no-match'

type SelectedPage = {
  page: IndexedPage
  content: string
}

type QuerySelectionResult = {
  mode: QuerySelectionMode
  pages: SelectedPage[]
}

export type WikiLinkResolution =
  | { status: 'resolved'; page: IndexedPage }
  | { status: 'ambiguous'; matches: IndexedPage[] }
  | { status: 'missing' }

export type QueryCommandInput = {
  knowledgeRoot: string
  question: string
}

export type QueryCitation = {
  target: string
  title: string
  filePath: string
  excerpt: string
}

export type QuerySynthesisSuggestion = {
  id: string
  status: 'suggested' | 'reviewed' | 'promoted'
  slug: string
  title: string
  filePath: string
}

export type QueryCommandResult = {
  question: string
  answer: string
  citations: QueryCitation[]
  synthesisSuggestion: QuerySynthesisSuggestion | null
}

export type StoredSynthesisSuggestion = {
  id: string
  type: 'synthesis-suggestion' | 'merge-candidate'
  status: 'suggested' | 'reviewed' | 'promoted'
  question: string
  title: string
  slug: string
  answer: string
  citations: QueryCitation[]
  relatedPages: string[]
  markdown: string
  createdAt: string
  updatedAt: string
  reviewedAt?: string
  reviewer?: string
  promotedAt?: string
  pagePath?: string
}

export async function runQuery(input: QueryCommandInput): Promise<QueryCommandResult> {
  const root = path.resolve(input.knowledgeRoot)
  const indexedPages = await loadIndexedPages(root)

  if (indexedPages.length === 0) {
    throw new Error(`Cannot query ${root}: wiki/index.md has no indexed pages.`)
  }

  const selection = await selectRelevantPages(root, input.question, indexedPages)
  const citations = selection.pages.map(({ page, content }) => ({
    target: page.target,
    title: page.title,
    filePath: page.filePath,
    excerpt: buildExcerpt(content),
  }))

  const answer = buildAnswer(input.question, selection)
  const suggestion = selection.mode === 'matched' && selection.pages[0]
    ? await persistSynthesisSuggestion({
        knowledgeRoot: root,
        question: input.question,
        answer,
        citations,
        primaryPage: selection.pages[0].page,
      })
    : null

  await appendWikiLog(
    root,
    `query\t${JSON.stringify({
      question: input.question,
      selectionMode: selection.mode,
      suggestionId: suggestion?.id ?? null,
      citationCount: citations.length,
    })}`,
  )

  return {
    question: input.question,
    answer,
    citations,
    synthesisSuggestion: suggestion,
  }
}

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
    pages.push({
      section: resolved.section,
      slug: resolved.slug,
      title: link.title,
      target: resolved.target,
      filePath: path.join(path.resolve(knowledgeRoot), 'wiki', resolved.section, `${resolved.slug}.md`),
    })
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

async function selectRelevantPages(
  knowledgeRoot: string,
  question: string,
  indexedPages: IndexedPage[],
): Promise<QuerySelectionResult> {
  const rankedPages = (await Promise.all(indexedPages.map(async (page) => {
    const content = await readWikiPageContentIfPresent(knowledgeRoot, page)
    return content === null
      ? null
      : {
          page,
          content,
          score: scorePage(question, page, content),
        }
  })))
    .filter((entry): entry is { page: IndexedPage; content: string; score: number } => entry !== null)
    .sort((left, right) => right.score - left.score || comparePageOrder(left.page, right.page))

  if (rankedPages.length === 0) {
    return {
      mode: 'no-match',
      pages: [],
    }
  }

  const seedPages = rankedPages.filter((entry) => entry.score > 0).slice(0, 2)

  if (seedPages.length === 0) {
    if (!isOverviewQuestion(question)) {
      return {
        mode: 'no-match',
        pages: [],
      }
    }

    const overviewPages = rankedPages
      .filter((entry) => entry.page.section === 'sources')
      .slice(0, 2)

    const fallbackOverviewPages = overviewPages.length > 0 ? overviewPages : rankedPages.slice(0, 2)
    const selected = new Map<string, SelectedPage>()

    for (const entry of fallbackOverviewPages) {
      addPageSelection(selected, entry.page, entry.content)
    }

    return {
      mode: 'overview',
      pages: [...selected.values()],
    }
  }

  const selected = new Map<string, SelectedPage>()
  const indexedContent = new Map(rankedPages.map((entry) => [entry.page.target, entry.content]))

  for (const entry of seedPages) {
    addPageSelection(selected, entry.page, entry.content)
  }

  for (const { page, content } of [...selected.values()]) {
    for (const link of parseWikiLinks(content)) {
      const resolved = resolveWikiLink(link.rawTarget, indexedPages)
      if (resolved.status !== 'resolved') {
        continue
      }

      const linkedContent = indexedContent.get(resolved.page.target)
      if (linkedContent === undefined) {
        continue
      }

      addPageSelection(selected, resolved.page, linkedContent)
      if (selected.size >= 4) {
        break
      }
    }

    if (selected.size >= 4) {
      break
    }
  }

  return {
    mode: 'matched',
    pages: [...selected.values()],
  }

  function addPageSelection(target: Map<string, SelectedPage>, page: IndexedPage, content: string) {
    if (target.has(page.target)) {
      return
    }

    target.set(page.target, { page, content })
  }
}

async function readWikiPageContent(knowledgeRoot: string, page: IndexedPage): Promise<string> {
  return readFile(path.join(knowledgeRoot, 'wiki', page.section, `${page.slug}.md`), 'utf8')
}

async function readWikiPageContentIfPresent(knowledgeRoot: string, page: IndexedPage): Promise<string | null> {
  try {
    return await readWikiPageContent(knowledgeRoot, page)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

function scorePage(question: string, page: IndexedPage, content: string): number {
  const questionTokens = tokenize(question)
  const titleTokens = new Set(tokenize(`${page.title} ${page.slug.replace(/-/g, ' ')}`))
  const contentTokens = new Set(tokenize(content))
  let score = 0

  for (const token of questionTokens) {
    if (titleTokens.has(token)) {
      score += 2
    } else if (contentTokens.has(token)) {
      score += 1
    }
  }

  if (score > 0 && page.section === 'sources') {
    score += 1
  }

  return score
}

function comparePageOrder(left: IndexedPage, right: IndexedPage): number {
  return wikiSectionRank(left.section) - wikiSectionRank(right.section)
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
}

function isOverviewQuestion(question: string): boolean {
  return OVERVIEW_PATTERNS.some((pattern) => pattern.test(question.trim()))
}

function buildAnswer(question: string, selection: QuerySelectionResult): string {
  if (selection.mode === 'no-match') {
    return `I could not find enough matching evidence in the indexed wiki to answer “${question}”. Try rephrasing with known page titles or ingesting more source material.`
  }

  if (selection.mode === 'overview') {
    const sourceSummaries = selection.pages
      .map(({ page, content }) => `${page.title}: ${extractSummary(content)}`)
      .join(' ')

    return compact(`Based on indexed sources, the wiki currently covers: ${sourceSummaries}`)
  }

  const primary = selection.pages[0]
  const related = selection.pages.slice(1)
  const summary = primary ? extractSummary(primary.content) : 'No indexed wiki page matched the question.'
  const relatedLead = related.length > 0
    ? ` Related pages: ${related.map(({ page }) => page.title).join(', ')}.`
    : ''

  return `${primary?.page.title ?? 'The wiki'} answers “${question}” with: ${summary}.${relatedLead}`.replace(/\.\./g, '.')
}

function extractSummary(markdown: string): string {
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const summaryMatch = normalized.match(/^## Summary\n([\s\S]*?)(?:\n## |$)/m)
  if (summaryMatch?.[1]) {
    return compact(summaryMatch[1])
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !line.startsWith('- Artifact ID:'))
    .filter((line) => !line.startsWith('- Source kind:'))
    .filter((line) => !line.startsWith('- Source ref:'))
    .filter((line) => !line.startsWith('- Analysis confidence:'))

  return compact(lines.slice(0, 3).join(' '))
}

function buildExcerpt(markdown: string): string {
  return compact(markdown.replace(/^# .*$/m, '')).slice(0, 240)
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

async function persistSynthesisSuggestion(input: {
  knowledgeRoot: string
  question: string
  answer: string
  citations: QueryCitation[]
  primaryPage: IndexedPage
}): Promise<QuerySynthesisSuggestion> {
  const id = `synthesis-${randomUUID()}`
  const createdAt = new Date().toISOString()
  const title = `${input.primaryPage.title} synthesis suggestion`
  const slug = buildSuggestionSlug(input.primaryPage.slug, id)
  const filePath = path.join(input.knowledgeRoot, 'review', 'queue', `${id}.json`)
  const mergeCandidatePath = path.join(input.knowledgeRoot, 'review', 'merge-candidates', `${id}.json`)
  const markdown = buildSuggestionMarkdown({
    title,
    question: input.question,
    answer: input.answer,
    citations: input.citations,
    suggestionId: id,
    createdAt,
  })

  const record: StoredSynthesisSuggestion = {
    id,
    type: 'synthesis-suggestion',
    status: 'suggested',
    question: input.question,
    title,
    slug,
    answer: input.answer,
    citations: input.citations,
    relatedPages: input.citations.map((citation) => citation.target),
    markdown,
    createdAt,
    updatedAt: createdAt,
  }

  await Promise.all([
    writeJsonFile(filePath, record),
    writeJsonFile(mergeCandidatePath, record),
  ])

  return {
    id,
    status: record.status,
    slug,
    title,
    filePath,
  }
}

function buildSuggestionSlug(primarySlug: string, suggestionId: string): string {
  const uniqueSuffix = suggestionId.replace(/^synthesis-/, '')
  return `${primarySlug}-query-synthesis-${uniqueSuffix}`
}

function buildSuggestionMarkdown(input: {
  title: string
  question: string
  answer: string
  citations: QueryCitation[]
  suggestionId: string
  createdAt: string
}): string {
  const citationLines = input.citations.length > 0
    ? input.citations.map((citation) => `- [[${citation.target}|${citation.title}]] — ${citation.excerpt}`)
    : ['- No supporting citations were captured.']

  return [
    `# ${input.title}`,
    '',
    `- Suggestion ID: ${input.suggestionId}`,
    `- Created at: ${input.createdAt}`,
    '',
    '## Query',
    input.question,
    '',
    '## Synthesis',
    input.answer,
    '',
    '## Citations',
    ...citationLines,
  ].join('\n').trimEnd() + '\n'
}

async function writeJsonFile(targetPath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, JSON.stringify(value, null, 2), 'utf8')
}
