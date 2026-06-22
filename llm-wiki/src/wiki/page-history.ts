import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type PageHistoryEntry = {
  section: 'sources' | 'entities' | 'concepts' | 'syntheses'
  slug: string
  title: string
}

const PAGE_HISTORY_HEADER = '# Page Log'
const fileWriteQueues = new Map<string, Promise<void>>()
const SAFE_SLUG_PATTERN = /^[a-z0-9-]+$/

export async function appendPageHistoryEntries(
  knowledgeRoot: string,
  pages: PageHistoryEntry[],
  message: string,
): Promise<string[]> {
  const root = path.resolve(knowledgeRoot)
  const writtenFiles: string[] = []

  for (const page of pages) {
    validatePageHistoryEntry(page)
    const filePath = pageHistoryPath(root, page.section, page.slug)
    await serializeFileUpdate(filePath, async () => {
      const existingContent = await readTextFileOrEmpty(filePath)
      const existingLines = existingContent
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== PAGE_HISTORY_HEADER)
      const event = {
        event: 'upsert',
        target: `${page.section}/${page.slug}`,
        title: page.title,
        message: message.trim(),
      }
      const nextLine = `${new Date().toISOString()}\t${JSON.stringify(event)}`
      const nextContent = [PAGE_HISTORY_HEADER, '', ...existingLines, nextLine].join('\n').trimEnd() + '\n'
      await atomicWriteFile(filePath, nextContent)
    })
    writtenFiles.push(filePath)
  }

  return writtenFiles
}

export async function removePageHistoryForWikiFile(knowledgeRoot: string, relativeFilePath: string): Promise<void> {
  const target = parseRelativeWikiPagePath(relativeFilePath)
  if (!target) {
    return
  }
  await rm(pageHistoryPath(path.resolve(knowledgeRoot), target.section, target.slug), { force: true })
}

export function pageHistoryPath(knowledgeRoot: string, section: PageHistoryEntry['section'], slug: string): string {
  return path.join(path.resolve(knowledgeRoot), 'wiki', section, slug, 'log.md')
}

async function readTextFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, filePath)
}

async function serializeFileUpdate<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previousTail = fileWriteQueues.get(filePath) ?? Promise.resolve()
  const runOperation = previousTail.catch(() => undefined).then(operation)
  const nextTail = runOperation.then(() => undefined, () => undefined)
  fileWriteQueues.set(filePath, nextTail)

  try {
    return await runOperation
  } finally {
    if (fileWriteQueues.get(filePath) === nextTail) {
      fileWriteQueues.delete(filePath)
    }
  }
}

function validatePageHistoryEntry(page: PageHistoryEntry): void {
  if (!SAFE_SLUG_PATTERN.test(page.slug)) {
    throw new Error(`Invalid slug for page history: ${page.slug}`)
  }
}

function parseRelativeWikiPagePath(relativeFilePath: string): { section: PageHistoryEntry['section']; slug: string } | null {
  const normalized = relativeFilePath.replace(/\\/g, '/')
  const match = /^wiki\/(sources|entities|concepts|syntheses)\/([a-z0-9-]+)\.md$/u.exec(normalized)
  return match ? { section: match[1] as PageHistoryEntry['section'], slug: match[2]! } : null
}
