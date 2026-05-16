import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { JobStatus, SourceKind } from '../types'

export type JobRecord = {
  id: string
  status: JobStatus
  sourceKind: SourceKind | 'unknown'
  sourceRef?: string
  details?: Record<string, unknown>
  updatedAt?: string
  createdAt?: string
}

type JobStoreState = {
  jobs: Record<string, JobRecord>
}

export type JobStore = {
  save(job: JobRecord): Promise<JobRecord>
  get(id: string): Promise<JobRecord | null>
  list(): Promise<JobRecord[]>
  updateStatus(id: string, status: JobStatus, details?: Record<string, unknown>): Promise<JobRecord | null>
}

const EMPTY_STATE: JobStoreState = { jobs: {} }
const storeWriteQueues = new Map<string, Promise<void>>()

async function readState(storePath: string): Promise<JobStoreState> {
  try {
    const raw = await readFile(storePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<JobStoreState>
    return {
      jobs: parsed.jobs ?? {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY_STATE, jobs: {} }
    }

    throw error
  }
}

async function writeState(storePath: string, state: JobStoreState): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true })
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8')
  await rename(tempPath, storePath)
}

export function createJobStore(storePath: string): JobStore {
  const storeKey = path.resolve(storePath)

  const withWriteLock = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previousTail = storeWriteQueues.get(storeKey) ?? Promise.resolve()
    const result = previousTail.catch(() => undefined).then(operation)
    const nextTail = result.then(() => undefined, () => undefined)

    storeWriteQueues.set(storeKey, nextTail)

    try {
      return await result
    } finally {
      if (storeWriteQueues.get(storeKey) === nextTail) {
        storeWriteQueues.delete(storeKey)
      }
    }
  }

  const awaitPendingWrites = async () => {
    await (storeWriteQueues.get(storeKey) ?? Promise.resolve())
  }

  return {
    async save(job) {
      return withWriteLock(async () => {
        const now = new Date().toISOString()
        const state = await readState(storePath)
        const existing = state.jobs[job.id]
        const nextJob: JobRecord = {
          ...existing,
          ...job,
          createdAt: existing?.createdAt ?? job.createdAt ?? now,
          updatedAt: job.updatedAt ?? now,
        }

        state.jobs[job.id] = nextJob
        await writeState(storePath, state)
        return nextJob
      })
    },
    async get(id) {
      await awaitPendingWrites()
      const state = await readState(storePath)
      return state.jobs[id] ?? null
    },
    async list() {
      await awaitPendingWrites()
      const state = await readState(storePath)
      return Object.values(state.jobs).sort((left, right) =>
        (left.createdAt ?? '').localeCompare(right.createdAt ?? ''),
      )
    },
    async updateStatus(id, status, details) {
      return withWriteLock(async () => {
        const state = await readState(storePath)
        const existing = state.jobs[id]

        if (!existing) {
          return null
        }

        const nextJob: JobRecord = {
          ...existing,
          status,
          details: details ?? existing.details,
          updatedAt: new Date().toISOString(),
        }

        state.jobs[id] = nextJob
        await writeState(storePath, state)
        return nextJob
      })
    },
  }
}
