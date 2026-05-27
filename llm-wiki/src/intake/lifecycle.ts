import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SourceKind } from '../types.js'
import { moveManagedRawFile, writeManagedRawFile } from './raw-store.js'

export type IntakeLifecycleState = {
  stagedPath: string | null
  archivePath: string | null
  rejectedPath: string | null
  retainedPath: string | null
}

export type StageIntakeInput = {
  knowledgeRoot: string
  inputPath: string
  jobId: string
  sourceKind?: SourceKind | 'unknown'
}

export type StageNormalizedArtifactInput = {
  knowledgeRoot: string
  jobId: string
  sourceKind: SourceKind | 'unknown'
  sourceRef: string
  title: string
  content: string
}

export type RejectIntakeInput = StageIntakeInput & {
  stagedPath?: string | null
}

function normalizeStorageName(inputPath: string, jobId: string): string {
  const extension = path.extname(inputPath)
  const baseName = path.basename(inputPath, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'source'
  return `${jobId}-${baseName}${extension || '.md'}`
}

function stagedRelativePath(inputPath: string, jobId: string): string {
  return path.join('raw', 'staged', shardForJob(jobId), normalizeStorageName(inputPath, jobId)).replace(/\\/g, '/')
}

function archivedRelativePath(stagedPath: string): string {
  const basename = path.basename(stagedPath)
  return path.join('raw', 'archive', shardForStorageName(basename), basename).replace(/\\/g, '/')
}

function rejectedRelativePath(inputPath: string, jobId: string): string {
  const storageName = normalizeStorageName(inputPath, jobId)
  return path.join('raw', 'rejected', shardForStorageName(storageName), storageName).replace(/\\/g, '/')
}

function shardForJob(jobId: string): string {
  return shardForStorageName(jobId)
}

function shardForStorageName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  return normalized.slice(0, 2) || 'xx'
}

export async function stageIntakeFile(input: StageIntakeInput): Promise<string> {
  const body = await readFile(input.inputPath, 'utf8')
  return writeManagedRawFile({
    knowledgeRoot: input.knowledgeRoot,
    relativePath: stagedRelativePath(input.inputPath, input.jobId),
    sourceKind: input.sourceKind ?? 'unknown',
    sourceRef: input.inputPath,
    jobId: input.jobId,
    body,
    state: 'staged',
  })
}

export async function stageNormalizedArtifact(input: StageNormalizedArtifactInput): Promise<string> {
  return writeManagedRawFile({
    knowledgeRoot: input.knowledgeRoot,
    relativePath: stagedRelativePath(`${input.title}.md`, input.jobId),
    sourceKind: input.sourceKind,
    sourceRef: input.sourceRef,
    jobId: input.jobId,
    body: input.content,
    state: 'staged',
  })
}

export async function archiveStagedFile(knowledgeRoot: string, stagedPath: string): Promise<string> {
  return moveManagedRawFile({
    knowledgeRoot,
    fromRelativePath: path.relative(path.resolve(knowledgeRoot), stagedPath),
    toRelativePath: archivedRelativePath(stagedPath),
    nextState: 'archived',
  })
}

export async function rejectIntakeFile(input: RejectIntakeInput): Promise<string> {
  const targetRejectedRelativePath = rejectedRelativePath(input.inputPath, input.jobId)
  const rejectedPath = path.join(path.resolve(input.knowledgeRoot), targetRejectedRelativePath)

  await mkdir(path.dirname(rejectedPath), { recursive: true })

  if (input.stagedPath) {
    return moveManagedRawFile({
      knowledgeRoot: input.knowledgeRoot,
      fromRelativePath: path.relative(path.resolve(input.knowledgeRoot), input.stagedPath),
      toRelativePath: targetRejectedRelativePath,
      nextState: 'rejected',
    })
  }

  try {
    return await writeManagedRawFile({
      knowledgeRoot: input.knowledgeRoot,
      relativePath: targetRejectedRelativePath,
      sourceKind: input.sourceKind ?? 'unknown',
      sourceRef: input.inputPath,
      jobId: input.jobId,
      body: await readFile(input.inputPath, 'utf8'),
      state: 'rejected',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }

    await writeFile(
      rejectedPath,
      [
        'Original intake could not be copied into raw/rejected.',
        `Input: ${input.inputPath}`,
        `Job: ${input.jobId}`,
        'Reason: source file was missing at rejection time.',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  return rejectedPath
}

export async function retainReviewableIntake(stagedPath: string): Promise<string> {
  return stagedPath
}

export function createEmptyLifecycleState(): IntakeLifecycleState {
  return {
    stagedPath: null,
    archivePath: null,
    rejectedPath: null,
    retainedPath: null,
  }
}
