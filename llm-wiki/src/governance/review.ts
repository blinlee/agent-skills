import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureKnowledgeRootLayout } from '../paths.js'
import { writeJsonFile } from '../shared/fs.js'

export type ReviewItemRecord = {
  id: string
  type: 'low-confidence' | 'conflict' | 'merge-candidate' | string
  issueSummary: string
  status: string
  artifactId?: string
  severity?: string
  reason?: string
  relatedSources?: string[]
  relatedPages?: string[]
  evidence?: string[]
  confidence?: number
  suggestedActions?: string[]
  candidate?: {
    kind: 'entity' | 'concept'
    slug: string
    title: string
    confidence: number
    source: string
    evidence: string[]
  }
  createdAt?: string
  updatedAt?: string
}

export type PersistReviewItemsResult = {
  files: string[]
}

export type ReviewOutputManifest = {
  reviewFiles: string[]
}

const REVIEW_GROUP_DIRECTORY: Record<string, string> = {
  'low-confidence': 'low-confidence',
  conflict: 'conflicts',
  'merge-candidate': 'merge-candidates',
  'source-metadata-mismatch': 'conflicts',
  'inbox-quality-required': 'quality',
  'inbox-quality-invalid': 'quality',
  'inbox-quality-blocked': 'quality',
}

const REVIEW_GROUP_DIRECTORIES = Object.values(REVIEW_GROUP_DIRECTORY)

export async function persistReviewItems(
  root: string,
  items: ReviewItemRecord[],
): Promise<PersistReviewItemsResult> {
  const paths = await ensureKnowledgeRootLayout(root)
  const files: string[] = []

  for (const item of items) {
    const record = materializeReviewItem(item)
    const queuePath = path.join(paths.reviewQueue, `${record.id}.json`)
    await writeJsonFile(queuePath, record)
    files.push(queuePath)

    const groupedDirectory = REVIEW_GROUP_DIRECTORY[record.type]
    await removeStaleGroupedReviewCopies(paths.root, record.id, groupedDirectory)

    if (!groupedDirectory) {
      continue
    }

    const groupedPath = path.join(paths.root, 'review', groupedDirectory, `${record.id}.json`)
    await writeJsonFile(groupedPath, record)
    files.push(groupedPath)
  }

  return { files }
}

export async function removeStaleReviewFiles(
  root: string,
  previousReviewFiles: string[],
  currentReviewFiles: string[],
): Promise<void> {
  const staleFiles = previousReviewFiles.filter((filePath) => !currentReviewFiles.includes(filePath))

  await Promise.all(staleFiles.map(async (filePath) => {
    const absolutePath = path.join(path.resolve(root), filePath)

    try {
      await rm(absolutePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }))
}

function materializeReviewItem(item: ReviewItemRecord): ReviewItemRecord {
  const now = new Date().toISOString()

  return {
    ...item,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  }
}

async function removeStaleGroupedReviewCopies(
  root: string,
  reviewId: string,
  currentGroupDirectory?: string,
): Promise<void> {
  await Promise.all(
    REVIEW_GROUP_DIRECTORIES
      .filter((directory) => directory !== currentGroupDirectory)
      .map(async (directory) => {
        const stalePath = path.join(root, 'review', directory, `${reviewId}.json`)

        try {
          await rm(stalePath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error
          }
        }
      }),
  )
}
