import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createParsedArtifact, normalizeTextBody, type ParsedArtifact } from './base'

export type RepoSourceInput = {
  sourceId: string
  repoPath: string
  maxSampleFiles?: number
  parsedAt?: string
}

type RepoFileCategory = 'readme' | 'docs' | 'sample'

type RepoFileSnapshot = {
  relativePath: string
  category: RepoFileCategory
  content: string
}

type RepoCaptureSelection = {
  captured: string[]
  omittedCount: number
}

const DEFAULT_MAX_SAMPLE_FILES = 3
const DEFAULT_MAX_README_FILES = 2
const DEFAULT_MAX_DOC_FILES = 2
const MAX_FILE_BYTES = 64 * 1024
const MAX_FILE_CHARS = 4_000
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage'])
const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.scss',
  '.html',
  '.sh',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
])

export async function parseRepoSource(input: RepoSourceInput): Promise<ParsedArtifact<'repo'>> {
  const absoluteRepoPath = path.resolve(input.repoPath)
  const rootStat = await stat(absoluteRepoPath)

  if (!rootStat.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${input.repoPath}`)
  }

  const allFiles = await listRepoFiles(absoluteRepoPath)
  const readmeFiles = prioritizeShallowPaths(allFiles.filter(isReadmeFile))
  const docFiles = prioritizeShallowPaths(allFiles.filter((filePath) => !isReadmeFile(filePath) && isDocFile(filePath)))
  const sampleCandidateFiles = allFiles.filter(
    (filePath) => !isReadmeFile(filePath) && !isDocFile(filePath) && isSampleCandidate(filePath),
  )

  const readmeSelection = selectFilesForCapture(readmeFiles, DEFAULT_MAX_README_FILES)
  const docSelection = selectFilesForCapture(docFiles, DEFAULT_MAX_DOC_FILES)
  const sampleSelection = selectFilesForCapture(sampleCandidateFiles, input.maxSampleFiles ?? DEFAULT_MAX_SAMPLE_FILES)

  const snapshots = await Promise.all([
    ...readmeSelection.captured.map((relativePath) => loadSnapshot(absoluteRepoPath, relativePath, 'readme')),
    ...docSelection.captured.map((relativePath) => loadSnapshot(absoluteRepoPath, relativePath, 'docs')),
    ...sampleSelection.captured.map((relativePath) => loadSnapshot(absoluteRepoPath, relativePath, 'sample')),
  ])

  const repoName = path.basename(absoluteRepoPath)
  const body = buildRepoBody({
    repoName,
    sourceRef: input.repoPath,
    snapshots,
    totalFiles: allFiles.length,
    omissions: {
      readme: readmeSelection.omittedCount,
      docs: docSelection.omittedCount,
      sample: sampleSelection.omittedCount,
    },
  })
  const artifact = createParsedArtifact({
    kind: 'repo',
    sourceId: input.sourceId,
    path: input.repoPath,
    title: repoName,
    body,
    parser: 'repo',
    parsedAt: input.parsedAt,
  })

  return {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      repoName,
      totalFiles: allFiles.length,
      readmeFiles: readmeFiles.length,
      capturedReadmeFiles: readmeSelection.captured.length,
      omittedReadmeFiles: readmeSelection.omittedCount,
      docFiles: docFiles.length,
      capturedDocFiles: docSelection.captured.length,
      omittedDocFiles: docSelection.omittedCount,
      sampleCandidateFiles: sampleCandidateFiles.length,
      sampledFiles: sampleSelection.captured.length,
      omittedSampleFiles: sampleSelection.omittedCount,
    },
  }
}

async function listRepoFiles(rootDirectory: string, relativeDirectory = ''): Promise<string[]> {
  const directoryPath = path.join(rootDirectory, relativeDirectory)
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...(await listRepoFiles(rootDirectory, relativePath)))
      }
      continue
    }

    if (entry.isFile()) {
      files.push(relativePath)
    }
  }

  return files
}

function isReadmeFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath)
  return /^readme(?:\.[^.]+)?$/i.test(basename)
}

function isDocFile(relativePath: string): boolean {
  const segments = relativePath.split('/')
  const extension = path.posix.extname(relativePath).toLowerCase()
  return segments.includes('docs') && TEXT_FILE_EXTENSIONS.has(extension)
}

function isSampleCandidate(relativePath: string): boolean {
  const extension = path.posix.extname(relativePath).toLowerCase()
  return TEXT_FILE_EXTENSIONS.has(extension)
}

function prioritizeShallowPaths(relativePaths: string[]): string[] {
  return [...relativePaths].sort((left, right) => {
    const depthDifference = left.split('/').length - right.split('/').length
    return depthDifference === 0 ? left.localeCompare(right) : depthDifference
  })
}

function selectFilesForCapture(relativePaths: string[], limit: number): RepoCaptureSelection {
  const normalizedLimit = Math.max(0, limit)

  return {
    captured: relativePaths.slice(0, normalizedLimit),
    omittedCount: Math.max(0, relativePaths.length - normalizedLimit),
  }
}

async function loadSnapshot(
  rootDirectory: string,
  relativePath: string,
  category: RepoFileCategory,
): Promise<RepoFileSnapshot> {
  const absolutePath = path.join(rootDirectory, relativePath)
  const fileStat = await stat(absolutePath)

  if (fileStat.size > MAX_FILE_BYTES) {
    return {
      relativePath,
      category,
      content: `[omitted: file exceeds ${MAX_FILE_BYTES} bytes limit for shallow repo parsing]`,
    }
  }

  const rawContent = await readFile(absolutePath, 'utf8')
  const normalizedContent = normalizeTextBody(rawContent)
  const content = normalizedContent.length > MAX_FILE_CHARS
    ? `${normalizedContent.slice(0, MAX_FILE_CHARS)}\n...[truncated for shallow repo parsing]`
    : normalizedContent

  return {
    relativePath,
    category,
    content,
  }
}

function buildRepoBody(input: {
  repoName: string
  sourceRef: string
  snapshots: RepoFileSnapshot[]
  totalFiles: number
  omissions: Record<RepoFileCategory, number>
}): string {
  const lines = [
    `Repository: ${input.repoName}`,
    `Source path: ${input.sourceRef}`,
    `Scan mode: shallow snapshot`,
    `Scope: prioritized README/docs plus limited text or code samples`,
    `Deep analysis: intentionally skipped`,
    `Files discovered: ${input.totalFiles}`,
    '',
    'Captured files:',
    ...(input.snapshots.length > 0
      ? [
          ...input.snapshots.map((snapshot) => `- [${snapshot.category}] ${snapshot.relativePath}`),
          ...buildOmissionMarkers(input.omissions),
        ]
      : ['- none', ...buildOmissionMarkers(input.omissions)]),
  ]

  for (const snapshot of input.snapshots) {
    lines.push('', `--- ${snapshot.relativePath} (${snapshot.category}) ---`, snapshot.content || '[empty file]')
  }

  return lines.join('\n')
}

function buildOmissionMarkers(omissions: Record<RepoFileCategory, number>): string[] {
  return [
    formatOmissionMarker('README', omissions.readme),
    formatOmissionMarker('docs', omissions.docs),
    formatOmissionMarker('sample', omissions.sample),
  ].filter((value): value is string => Boolean(value))
}

function formatOmissionMarker(label: string, omittedCount: number): string | undefined {
  if (omittedCount <= 0) {
    return undefined
  }

  const suffix = omittedCount === 1 ? 'file' : 'files'
  return `- [omitted: ${omittedCount} additional ${label} ${suffix} skipped to preserve shallow repo boundary]`
}
