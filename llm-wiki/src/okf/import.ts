import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runBuildIndex, type BuildIndexResult } from '../index/wiki-index.js'
import { runEmbedIndex, type EmbedIndexResult } from '../retrieval/embed-index.js'
import { missingEmbeddingProviderMessage } from '../retrieval/embedding-provider.js'
import { ensureKnowledgeRootLayout } from '../paths.js'
import { appendWikiLog, updateWikiIndex } from '../wiki/index-log.js'
import { parseMarkdownWithFrontmatter } from './frontmatter.js'

export type ImportOkfBundleInput = {
  knowledgeRoot: string
  bundleDir: string
  autoIndex?: boolean
  now?: string
}

export type ImportedOkfPage = {
  okfPath: string
  pageTarget: string
  title: string
  okfType: string
  isDirectoryIndex: boolean
}

export type ImportOkfBundleResult = {
  knowledgeRoot: string
  bundleDir: string
  importedCount: number
  importedPages: ImportedOkfPage[]
  index: BuildIndexResult | null
  embedding: OkfEmbeddingIndexResult | null
}

export type OkfEmbeddingIndexResult =
  | ({ status: 'rebuilt' } & Pick<EmbedIndexResult, 'provider' | 'model' | 'reusedCount' | 'embeddedCount' | 'staleRemovedCount'>)
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }

export async function importOkfBundle(input: ImportOkfBundleInput): Promise<ImportOkfBundleResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const bundleDir = path.resolve(input.bundleDir)
  const now = input.now ?? new Date().toISOString()
  await ensureKnowledgeRootLayout(knowledgeRoot)

  const files = (await listMarkdownFiles(bundleDir))
    .filter((filePath) => path.basename(filePath) !== 'log.md')
    .sort((left, right) => left.localeCompare(right))
  const usedSlugs = await existingSourceSlugs(knowledgeRoot)
  const importedPages: ImportedOkfPage[] = []
  const indexEntries: string[] = []

  for (const filePath of files) {
    const relativePath = path.relative(bundleDir, filePath).replace(/\\/g, '/')
    const parsed = parseMarkdownWithFrontmatter(await readFile(filePath, 'utf8'))
    const isDirectoryIndex = path.basename(filePath) === 'index.md'
    const okfType = isDirectoryIndex ? 'OKF Directory Index' : stringField(parsed.frontmatter, 'type') ?? ''
    if (!okfType) {
      throw new Error(`OKF concept missing required frontmatter type: ${relativePath}`)
    }
    const title = stringField(parsed.frontmatter, 'title') ?? deriveTitle(relativePath, isDirectoryIndex)
    const slug = uniqueSlug(`okf-${slugify(relativePath.replace(/\.md$/i, ''))}`, usedSlugs)
    const pageTarget = `sources/${slug}`
    const outputPath = path.join(knowledgeRoot, 'wiki', 'sources', `${slug}.md`)
    const content = formatImportedSourcePage({
      title,
      now,
      okfPath: relativePath,
      okfType,
      okfDescription: stringField(parsed.frontmatter, 'description'),
      resource: stringField(parsed.frontmatter, 'resource'),
      tags: stringArrayField(parsed.frontmatter, 'tags'),
      timestamp: stringField(parsed.frontmatter, 'timestamp'),
      isDirectoryIndex,
      body: parsed.body,
    })

    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, content, 'utf8')
    importedPages.push({ okfPath: relativePath, pageTarget, title, okfType, isDirectoryIndex })
    indexEntries.push(`- [[${pageTarget}|${title}]]`)
  }

  if (indexEntries.length > 0) {
    await updateWikiIndex(knowledgeRoot, indexEntries)
    await appendWikiLog(knowledgeRoot, `imported OKF bundle ${bundleDir} (${indexEntries.length} page(s))`)
  }

  let index: BuildIndexResult | null = null
  let embedding: ImportOkfBundleResult['embedding'] = null
  if (input.autoIndex) {
    index = await runBuildIndex({ knowledgeRoot })
    try {
      const embed = await runEmbedIndex({ knowledgeRoot })
      embedding = {
        status: 'rebuilt',
        provider: embed.provider,
        model: embed.model,
        reusedCount: embed.reusedCount,
        embeddedCount: embed.embeddedCount,
        staleRemovedCount: embed.staleRemovedCount,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      embedding = message === missingEmbeddingProviderMessage()
        ? { status: 'skipped', reason: message }
        : { status: 'failed', error: message }
    }
  }

  return {
    knowledgeRoot,
    bundleDir,
    importedCount: importedPages.length,
    importedPages,
    index,
    embedding,
  }
}

async function existingSourceSlugs(knowledgeRoot: string): Promise<Set<string>> {
  const sourceDir = path.join(knowledgeRoot, 'wiki', 'sources')
  try {
    const entries = await readdir(sourceDir, { withFileTypes: true })
    return new Set(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'index.md')
      .map((entry) => entry.name.replace(/\.md$/i, '')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set()
    }
    throw error
  }
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const filePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(filePath))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(filePath)
    }
  }
  return files
}

function formatImportedSourcePage(input: {
  title: string
  now: string
  okfPath: string
  okfType: string
  okfDescription: string | null
  resource: string | null
  tags: string[]
  timestamp: string | null
  isDirectoryIndex: boolean
  body: string
}): string {
  const sources = input.resource ? [input.resource] : [input.okfPath]
  const body = input.body.trim().length > 0
    ? input.body.trim()
    : `# ${input.title}\n\nImported OKF ${input.isDirectoryIndex ? 'directory index' : 'concept'} from ${input.okfPath}.`
  const normalizedBody = body.startsWith('# ') ? body : `# ${input.title}\n\n${body}`
  return [
    '---',
    `title: ${JSON.stringify(input.title)}`,
    `created: ${JSON.stringify(input.now)}`,
    `updated: ${JSON.stringify(input.timestamp ?? input.now)}`,
    'type: "source"',
    `tags: ${JSON.stringify(input.tags)}`,
    `sources: ${JSON.stringify(sources)}`,
    'confidence: "medium"',
    'contested: false',
    'importedFrom: "okf"',
    'okfVersion: "0.1"',
    `okfPath: ${JSON.stringify(input.okfPath)}`,
    `okfType: ${JSON.stringify(input.okfType)}`,
    `okfDescription: ${JSON.stringify(input.okfDescription ?? '')}`,
    `okfDirectoryIndex: ${input.isDirectoryIndex ? 'true' : 'false'}`,
    '---',
    normalizedBody,
    '',
  ].join('\n')
}

function deriveTitle(relativePath: string, isDirectoryIndex: boolean): string {
  if (isDirectoryIndex) {
    const directory = path.posix.dirname(relativePath)
    return directory === '.' ? 'OKF Root Index' : `OKF ${titleFromSlug(directory)} Index`
  }
  return titleFromSlug(path.posix.basename(relativePath, '.md'))
}

function titleFromSlug(value: string): string {
  return value.split(/[\/_-]+/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function uniqueSlug(base: string, used: Set<string>): string {
  let candidate = base || 'okf-page'
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const item = value[key]
  return typeof item === 'string' && item.trim().length > 0 ? item.trim() : null
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const item = value[key]
  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string') : []
}
