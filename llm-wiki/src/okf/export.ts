import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadIndexedPages, type IndexedPage } from '../wiki/links.js'
import { createTarGzArchive } from './archive.js'
import { formatYamlFrontmatter, parseMarkdownWithFrontmatter } from './frontmatter.js'

const OKF_EXPORT_MANIFEST = '.llm-wiki-okf-export.json'

export type ExportOkfBundleInput = {
  knowledgeRoot: string
  outputDir: string
  archivePath?: string
  now?: string
}

export type ExportOkfBundleResult = {
  knowledgeRoot: string
  outputDir: string
  conceptCount: number
  indexFileCount: number
  copiedLogFile: string | null
  archiveFile: string
  archiveEntryCount: number
  files: string[]
}

type OkfConcept = {
  page: IndexedPage
  description: string
  content: string
  outputPath: string
  outputRelativePath: string
}

export async function exportOkfBundle(input: ExportOkfBundleInput): Promise<ExportOkfBundleResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const outputDir = path.resolve(input.outputDir)
  const generatedAt = input.now ?? new Date().toISOString()

  await prepareOutputDirectory(knowledgeRoot, outputDir)
  const pages = await loadIndexedPages(knowledgeRoot)

  const concepts: OkfConcept[] = []
  const files: string[] = []
  for (const page of pages) {
    const source = await readFile(page.filePath, 'utf8')
    const parsed = parseMarkdownWithFrontmatter(source)
    const title = stringField(parsed.frontmatter, 'title') ?? page.title
    const type = stringField(parsed.frontmatter, 'type') ?? defaultTypeForSection(page.section)
    const tags = stringArrayField(parsed.frontmatter, 'tags')
    const resource = firstSource(parsed.frontmatter)
    const timestamp = stringField(parsed.frontmatter, 'updated') ?? stringField(parsed.frontmatter, 'created') ?? generatedAt
    const description = descriptionFrom(parsed.body)
    const outputRelativePath = `${page.target}.md`
    const outputPath = path.join(outputDir, outputRelativePath)
    const okfFrontmatter = formatYamlFrontmatter({
      type,
      title,
      description,
      resource: resource ?? '',
      tags,
      timestamp,
      'x-llmwiki-target': page.target,
      'x-llmwiki-section': page.section,
      'x-llmwiki-source-path': path.relative(knowledgeRoot, page.filePath).replace(/\\/g, '/'),
    })
    const content = `${okfFrontmatter}${parsed.body.trimEnd()}\n`
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, content, 'utf8')
    const pageLogFile = await copyPageLogFile({
      knowledgeRoot,
      outputDir,
      pageTarget: page.target,
    })
    concepts.push({ page: { ...page, title }, description, content, outputPath, outputRelativePath })
    files.push(outputPath)
    if (pageLogFile) {
      files.push(pageLogFile)
    }
  }

  const indexFiles = await writeOkfIndexes(outputDir, concepts, generatedAt)
  files.push(...indexFiles)
  const manifestPath = path.join(outputDir, OKF_EXPORT_MANIFEST)
  await writeFile(manifestPath, JSON.stringify({
    schema: 'llm-wiki.okf-export.v1',
    knowledgeRoot,
    generatedAt,
    conceptCount: concepts.length,
  }, null, 2), 'utf8')
  files.push(manifestPath)

  const sourceLogPath = path.join(knowledgeRoot, 'wiki', 'log.md')
  let copiedLogFile: string | null = null
  try {
    copiedLogFile = path.join(outputDir, 'log.md')
    await copyFile(sourceLogPath, copiedLogFile)
    files.push(copiedLogFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    copiedLogFile = null
  }
  const archive = await createTarGzArchive({
    sourceDir: outputDir,
    archivePath: input.archivePath ? path.resolve(input.archivePath) : `${outputDir}.tar.gz`,
  })

  return {
    knowledgeRoot,
    outputDir,
    conceptCount: concepts.length,
    indexFileCount: indexFiles.length,
    copiedLogFile,
    archiveFile: archive.archivePath,
    archiveEntryCount: archive.fileCount,
    files: files.sort((left, right) => left.localeCompare(right)),
  }
}

async function prepareOutputDirectory(knowledgeRoot: string, outputDir: string): Promise<void> {
  if (pathsOverlap(knowledgeRoot, outputDir)) {
    throw new Error(`Refusing to export OKF bundle to a path overlapping the knowledge root: ${outputDir}`)
  }
  try {
    const current = await stat(outputDir)
    if (!current.isDirectory()) {
      throw new Error(`OKF output path exists and is not a directory: ${outputDir}`)
    }
    const entries = await readdir(outputDir)
    if (entries.length > 0 && !entries.includes(OKF_EXPORT_MANIFEST)) {
      throw new Error(`Refusing to delete non-OKF output directory: ${outputDir}`)
    }
    await rm(outputDir, { recursive: true, force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  await mkdir(outputDir, { recursive: true })
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrInside(left, right) || isSameOrInside(right, left)
}

function isSameOrInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function copyPageLogFile(input: { knowledgeRoot: string; outputDir: string; pageTarget: string }): Promise<string | null> {
  const sourceLogPath = path.join(input.knowledgeRoot, 'wiki', input.pageTarget, 'log.md')
  const outputLogPath = path.join(input.outputDir, input.pageTarget, 'log.md')
  try {
    await mkdir(path.dirname(outputLogPath), { recursive: true })
    await copyFile(sourceLogPath, outputLogPath)
    return outputLogPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return null
  }
}

async function writeOkfIndexes(outputDir: string, concepts: OkfConcept[], generatedAt: string): Promise<string[]> {
  const groups = new Map<string, OkfConcept[]>()
  groups.set('.', concepts)
  for (const concept of concepts) {
    const directory = path.posix.dirname(concept.outputRelativePath)
    groups.set(directory, [...(groups.get(directory) ?? []), concept])
  }

  const files: string[] = []
  for (const [directory, entries] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const outputPath = path.join(outputDir, directory === '.' ? 'index.md' : path.join(directory, 'index.md'))
    const title = directory === '.' ? 'OKF Bundle Index' : `${directory} Index`
    const body = `${formatYamlFrontmatter({
      type: 'directory-index',
      title,
      description: `Directory index for ${directory === '.' ? 'the OKF bundle' : directory}.`,
      resource: '',
      tags: ['okf-index'],
      timestamp: generatedAt,
      'x-llmwiki-target': directory === '.' ? 'index' : `${directory}/index`,
      'x-llmwiki-section': 'index',
      'x-llmwiki-source-path': directory === '.' ? 'index.md' : `${directory}/index.md`,
    })}${[
      `# ${title}`,
      '',
      ...entries
        .sort((left, right) => left.outputRelativePath.localeCompare(right.outputRelativePath))
        .map((entry) => {
          const href = directory === '.'
            ? entry.outputRelativePath
            : path.posix.basename(entry.outputRelativePath)
          return `* [${entry.page.title}](${href}) - ${entry.description}`
        }),
      '',
    ].join('\n')}`
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, body, 'utf8')
    files.push(outputPath)
  }
  return files
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

function firstSource(frontmatter: Record<string, unknown>): string | null {
  const resource = stringField(frontmatter, 'resource')
  if (resource) return resource
  const sources = stringArrayField(frontmatter, 'sources')
  return sources[0] ?? null
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const item = value[key]
  return typeof item === 'string' && item.trim().length > 0 ? item.trim() : null
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const item = value[key]
  return Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string') : []
}

function defaultTypeForSection(section: string): string {
  return section.endsWith('s') ? section.slice(0, -1) : section
}
