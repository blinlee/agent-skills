import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadIndexedPages, type IndexedPage } from '../wiki/links.js'
import { formatYamlFrontmatter, parseMarkdownWithFrontmatter } from './frontmatter.js'

export type GenerateOkfDirectoryIndexesInput = {
  knowledgeRoot: string
}

export type OkfDirectoryIndexFile = {
  directory: string
  filePath: string
  entryCount: number
}

export type GenerateOkfDirectoryIndexesResult = {
  knowledgeRoot: string
  generatedCount: number
  indexedPageCount: number
  skippedMissingPages: string[]
  files: OkfDirectoryIndexFile[]
}

type DirectoryEntry = {
  title: string
  href: string
  description: string
}

export async function generateOkfDirectoryIndexes(input: GenerateOkfDirectoryIndexesInput): Promise<GenerateOkfDirectoryIndexesResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const pages = await loadIndexedPages(knowledgeRoot)
  const groups = new Map<string, DirectoryEntry[]>()
  const skippedMissingPages: string[] = []

  for (const page of pages) {
    let content: string
    try {
      content = await readFile(page.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        skippedMissingPages.push(page.target)
        continue
      }
      throw error
    }

    const parsed = parseMarkdownWithFrontmatter(content)
    const title = stringField(parsed.frontmatter, 'title') ?? page.title
    const directory = directoryForPage(page)
    const href = hrefForPage(page, directory)
    const entry: DirectoryEntry = {
      title,
      href,
      description: stringField(parsed.frontmatter, 'description') ?? descriptionFrom(parsed.body),
    }
    groups.set(directory, [...(groups.get(directory) ?? []), entry])
  }

  const files: OkfDirectoryIndexFile[] = []
  for (const [directory, entries] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const filePath = path.join(knowledgeRoot, 'wiki', directory, 'index.md')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, renderDirectoryIndex(directory, entries), 'utf8')
    files.push({
      directory,
      filePath,
      entryCount: entries.length,
    })
  }

  return {
    knowledgeRoot,
    generatedCount: files.length,
    indexedPageCount: pages.length - skippedMissingPages.length,
    skippedMissingPages,
    files,
  }
}

function directoryForPage(page: IndexedPage): string {
  return path.posix.dirname(page.target)
}

function hrefForPage(page: IndexedPage, directory: string): string {
  const relative = path.posix.relative(directory, page.target)
  return `${relative}.md`
}

function renderDirectoryIndex(directory: string, entries: DirectoryEntry[]): string {
  const title = `${titleCase(path.posix.basename(directory))} Index`
  return `${formatYamlFrontmatter({
    type: 'directory-index',
    title,
    description: `Directory index for ${directory}.`,
    resource: '',
    tags: ['okf-index'],
    timestamp: new Date().toISOString(),
    'x-llmwiki-target': `${directory}/index`,
    'x-llmwiki-section': 'index',
    'x-llmwiki-source-path': `wiki/${directory}/index.md`,
  })}${[
    `# ${title}`,
    '',
    ...entries
      .sort((left, right) => left.href.localeCompare(right.href))
      .map((entry) => `* [${entry.title}](${entry.href}) - ${entry.description}`),
    '',
  ].join('\n')}`
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const item = value[key]
  return typeof item === 'string' && item.trim().length > 0 ? item.trim() : null
}

function descriptionFrom(body: string): string {
  const text = body
    .replace(/^#\s+.+$/gm, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .find((paragraph) => paragraph.length > 0)
  if (!text) {
    return 'No description available.'
  }
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}...` : text
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
