import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { moveManagedRawFile, writeManagedRawFile } from './raw-store.js';
function normalizeStorageName(inputPath, jobId) {
    const extension = path.extname(inputPath);
    const baseName = path.basename(inputPath, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
    return `${jobId}-${baseName}${extension || '.md'}`;
}
function stagedRelativePath(inputPath, jobId) {
    return path.join('raw', 'staged', shardForJob(jobId), normalizeStorageName(inputPath, jobId)).replace(/\\/g, '/');
}
function archivedRelativePath(stagedPath) {
    const basename = path.basename(stagedPath);
    return path.join('raw', 'archive', shardForStorageName(basename), basename).replace(/\\/g, '/');
}
function rejectedRelativePath(inputPath, jobId) {
    const storageName = normalizeStorageName(inputPath, jobId);
    return path.join('raw', 'rejected', shardForStorageName(storageName), storageName).replace(/\\/g, '/');
}
function shardForJob(jobId) {
    return shardForStorageName(jobId);
}
function shardForStorageName(value) {
    const normalized = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return normalized.slice(0, 2) || 'xx';
}
export async function stageIntakeFile(input) {
    const body = await readFile(input.inputPath, 'utf8');
    return writeManagedRawFile({
        knowledgeRoot: input.knowledgeRoot,
        relativePath: stagedRelativePath(input.inputPath, input.jobId),
        sourceKind: input.sourceKind ?? 'unknown',
        sourceRef: input.inputPath,
        jobId: input.jobId,
        body,
        state: 'staged',
    });
}
export async function stageNormalizedArtifact(input) {
    return writeManagedRawFile({
        knowledgeRoot: input.knowledgeRoot,
        relativePath: stagedRelativePath(`${input.title}.md`, input.jobId),
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef,
        jobId: input.jobId,
        body: input.content,
        state: 'staged',
    });
}
export async function archiveStagedFile(knowledgeRoot, stagedPath) {
    return moveManagedRawFile({
        knowledgeRoot,
        fromRelativePath: path.relative(path.resolve(knowledgeRoot), stagedPath),
        toRelativePath: archivedRelativePath(stagedPath),
        nextState: 'archived',
    });
}
export async function rejectIntakeFile(input) {
    const targetRejectedRelativePath = rejectedRelativePath(input.inputPath, input.jobId);
    const rejectedPath = path.join(path.resolve(input.knowledgeRoot), targetRejectedRelativePath);
    await mkdir(path.dirname(rejectedPath), { recursive: true });
    if (input.stagedPath) {
        return moveManagedRawFile({
            knowledgeRoot: input.knowledgeRoot,
            fromRelativePath: path.relative(path.resolve(input.knowledgeRoot), input.stagedPath),
            toRelativePath: targetRejectedRelativePath,
            nextState: 'rejected',
        });
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
        });
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        await writeFile(rejectedPath, [
            'Original intake could not be copied into raw/rejected.',
            `Input: ${input.inputPath}`,
            `Job: ${input.jobId}`,
            'Reason: source file was missing at rejection time.',
            '',
        ].join('\n'), 'utf8');
    }
    return rejectedPath;
}
export async function retainReviewableIntake(stagedPath) {
    return stagedPath;
}
export function createEmptyLifecycleState() {
    return {
        stagedPath: null,
        archivePath: null,
        rejectedPath: null,
        retainedPath: null,
    };
}
