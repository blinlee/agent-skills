import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from '../config.js'
import { defaultKnowledgeLayout, requiredKnowledgeFiles } from '../paths.js'
import { exists } from '../shared/fs.js'
import type { JobStatus } from '../types.js'

export type StatusCommandInput = {
  knowledgeRoot: string
}

export type StatusCommandResult = {
  knowledgeRoot: string
  knowledgeRootExists: boolean
  readiness: 'ready' | 'incomplete'
  configSummary: ReturnType<typeof loadConfig>
  jobCounts: Partial<Record<JobStatus, number>>
  jobCountsByState: Partial<Record<JobStatus, number>>
  requiredDirectories: {
    present: string[]
    missing: string[]
  }
  requiredFiles: {
    present: string[]
    missing: string[]
  }
}

export async function runStatusCommand(input: StatusCommandInput): Promise<StatusCommandResult> {
  const knowledgeRoot = path.resolve(input.knowledgeRoot)
  const configSummary = loadConfig({
    knowledgeRoot,
    jobStorePath: path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'),
  })

  const requiredDirectories = await summarizeRequiredPaths(knowledgeRoot, defaultKnowledgeLayout)
  const requiredFiles = await summarizeRequiredPaths(
    knowledgeRoot,
    requiredKnowledgeFiles.map((file) => file.relativePath),
  )
  const jobCountsByState = await readJobCounts(configSummary.jobStorePath)
  const jobCounts = { ...jobCountsByState }
  const readiness = requiredDirectories.missing.length === 0 && requiredFiles.missing.length === 0
    ? 'ready'
    : 'incomplete'

  return {
    knowledgeRoot,
    knowledgeRootExists: await exists(knowledgeRoot),
    readiness,
    configSummary,
    jobCounts,
    jobCountsByState,
    requiredDirectories,
    requiredFiles,
  }
}

async function summarizeRequiredPaths(knowledgeRoot: string, relativePaths: readonly string[]): Promise<{ present: string[]; missing: string[] }> {
  const present: string[] = []
  const missing: string[] = []

  for (const relativePath of relativePaths) {
    const targetPath = path.join(knowledgeRoot, relativePath)
    if (await exists(targetPath)) {
      present.push(relativePath)
    } else {
      missing.push(relativePath)
    }
  }

  return { present, missing }
}

async function readJobCounts(jobStorePath: string): Promise<Partial<Record<JobStatus, number>>> {
  try {
    const raw = await readFile(jobStorePath, 'utf8')
    const parsed = JSON.parse(raw) as { jobs?: Record<string, { status?: JobStatus }> }
    const counts: Partial<Record<JobStatus, number>> = {}

    for (const job of Object.values(parsed.jobs ?? {})) {
      if (!job.status) {
        continue
      }

      counts[job.status] = (counts[job.status] ?? 0) + 1
    }

    return counts
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }

    throw error
  }
}
