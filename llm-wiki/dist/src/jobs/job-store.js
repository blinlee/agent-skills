import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
const EMPTY_STATE = { jobs: {} };
const storeWriteQueues = new Map();
async function readState(storePath) {
    try {
        const raw = await readFile(storePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            jobs: parsed.jobs ?? {},
        };
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { ...EMPTY_STATE, jobs: {} };
        }
        throw error;
    }
}
async function writeState(storePath, state) {
    await mkdir(path.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(tempPath, storePath);
}
export function createJobStore(storePath) {
    const storeKey = path.resolve(storePath);
    const withWriteLock = async (operation) => {
        const previousTail = storeWriteQueues.get(storeKey) ?? Promise.resolve();
        const result = previousTail.catch(() => undefined).then(operation);
        const nextTail = result.then(() => undefined, () => undefined);
        storeWriteQueues.set(storeKey, nextTail);
        try {
            return await result;
        }
        finally {
            if (storeWriteQueues.get(storeKey) === nextTail) {
                storeWriteQueues.delete(storeKey);
            }
        }
    };
    const awaitPendingWrites = async () => {
        await (storeWriteQueues.get(storeKey) ?? Promise.resolve());
    };
    return {
        async save(job) {
            return withWriteLock(async () => {
                const now = new Date().toISOString();
                const state = await readState(storePath);
                const existing = state.jobs[job.id];
                const nextJob = {
                    ...existing,
                    ...job,
                    createdAt: existing?.createdAt ?? job.createdAt ?? now,
                    updatedAt: job.updatedAt ?? now,
                };
                state.jobs[job.id] = nextJob;
                await writeState(storePath, state);
                return nextJob;
            });
        },
        async get(id) {
            await awaitPendingWrites();
            const state = await readState(storePath);
            return state.jobs[id] ?? null;
        },
        async list() {
            await awaitPendingWrites();
            const state = await readState(storePath);
            return Object.values(state.jobs).sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
        },
        async updateStatus(id, status, details) {
            return withWriteLock(async () => {
                const state = await readState(storePath);
                const existing = state.jobs[id];
                if (!existing) {
                    return null;
                }
                const nextJob = {
                    ...existing,
                    status,
                    details: details ?? existing.details,
                    updatedAt: new Date().toISOString(),
                };
                state.jobs[id] = nextJob;
                await writeState(storePath, state);
                return nextJob;
            });
        },
    };
}
