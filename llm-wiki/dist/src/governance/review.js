import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureKnowledgeRootLayout } from '../paths.js';
const REVIEW_GROUP_DIRECTORY = {
    'low-confidence': 'low-confidence',
    conflict: 'conflicts',
    'merge-candidate': 'merge-candidates',
};
const REVIEW_GROUP_DIRECTORIES = Object.values(REVIEW_GROUP_DIRECTORY);
export async function persistReviewItems(root, items) {
    const paths = await ensureKnowledgeRootLayout(root);
    const files = [];
    for (const item of items) {
        const record = materializeReviewItem(item);
        const queuePath = path.join(paths.reviewQueue, `${record.id}.json`);
        await writeJsonFile(queuePath, record);
        files.push(queuePath);
        const groupedDirectory = REVIEW_GROUP_DIRECTORY[record.type];
        await removeStaleGroupedReviewCopies(paths.root, record.id, groupedDirectory);
        if (!groupedDirectory) {
            continue;
        }
        const groupedPath = path.join(paths.root, 'review', groupedDirectory, `${record.id}.json`);
        await writeJsonFile(groupedPath, record);
        files.push(groupedPath);
    }
    return { files };
}
export async function removeStaleReviewFiles(root, previousReviewFiles, currentReviewFiles) {
    const staleFiles = previousReviewFiles.filter((filePath) => !currentReviewFiles.includes(filePath));
    await Promise.all(staleFiles.map(async (filePath) => {
        const absolutePath = path.join(path.resolve(root), filePath);
        try {
            await rm(absolutePath);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }));
}
function materializeReviewItem(item) {
    const now = new Date().toISOString();
    return {
        ...item,
        createdAt: item.createdAt ?? now,
        updatedAt: item.updatedAt ?? now,
    };
}
async function removeStaleGroupedReviewCopies(root, reviewId, currentGroupDirectory) {
    await Promise.all(REVIEW_GROUP_DIRECTORIES
        .filter((directory) => directory !== currentGroupDirectory)
        .map(async (directory) => {
        const stalePath = path.join(root, 'review', directory, `${reviewId}.json`);
        try {
            await rm(stalePath);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }));
}
async function writeJsonFile(targetPath, value) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify(value, null, 2), 'utf8');
}
