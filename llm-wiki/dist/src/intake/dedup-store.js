import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
async function readManifest(manifestPath) {
    try {
        const raw = await readFile(manifestPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            entries: Object.fromEntries(Object.entries(parsed.entries ?? {}).map(([identity, entry]) => [
                identity,
                {
                    ...entry,
                    lastOutputManifest: entry?.lastOutputManifest
                        ? {
                            ...entry.lastOutputManifest,
                            reviewFiles: entry.lastOutputManifest.reviewFiles ?? [],
                            pageSnapshots: entry.lastOutputManifest.pageSnapshots ?? [],
                        }
                        : null,
                },
            ])),
        };
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { entries: {} };
        }
        throw error;
    }
}
const manifestWriteQueues = new Map();
async function writeManifest(manifestPath, manifest) {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(manifest, null, 2), 'utf8');
    await rename(tempPath, manifestPath);
}
export function createDedupStore(manifestPath) {
    const manifestKey = path.resolve(manifestPath);
    const withWriteLock = async (operation) => {
        const previousTail = manifestWriteQueues.get(manifestKey) ?? Promise.resolve();
        const result = previousTail.catch(() => undefined).then(operation);
        const nextTail = result.then(() => undefined, () => undefined);
        manifestWriteQueues.set(manifestKey, nextTail);
        try {
            return await result;
        }
        finally {
            if (manifestWriteQueues.get(manifestKey) === nextTail) {
                manifestWriteQueues.delete(manifestKey);
            }
        }
    };
    const awaitPendingWrites = async () => {
        await (manifestWriteQueues.get(manifestKey) ?? Promise.resolve());
    };
    const get = async (identity) => {
        await awaitPendingWrites();
        const manifest = await readManifest(manifestPath);
        return manifest.entries[identity] ?? null;
    };
    return {
        get,
        async list() {
            await awaitPendingWrites();
            const manifest = await readManifest(manifestPath);
            return Object.values(manifest.entries);
        },
        async shouldCompile(input) {
            const existing = await get(input.identity);
            if (!existing) {
                return { action: 'compile', reason: 'first-seen' };
            }
            if (existing.lastFingerprint === input.fingerprint && existing.sourceKind === input.sourceKind) {
                return { action: 'skip', reason: 'unchanged' };
            }
            return { action: 'recompile', reason: 'changed' };
        },
        async recordSuccess(input) {
            return withWriteLock(async () => {
                const manifest = await readManifest(manifestPath);
                const nextEntry = {
                    identity: input.identity,
                    lastFingerprint: input.fingerprint,
                    sourceKind: input.sourceKind,
                    lastSuccessfulJobId: input.jobId,
                    lastCompiledAt: input.compiledAt ?? new Date().toISOString(),
                    lastOutputManifest: input.outputManifest
                        ? {
                            ...input.outputManifest,
                            reviewFiles: input.outputManifest.reviewFiles ?? [],
                            pageSnapshots: input.outputManifest.pageSnapshots ?? [],
                        }
                        : null,
                };
                manifest.entries[input.identity] = nextEntry;
                await writeManifest(manifestPath, manifest);
                return nextEntry;
            });
        },
    };
}
