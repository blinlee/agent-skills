import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { defaultKnowledgeLayout, requiredKnowledgeFiles } from '../paths.js';
import { exists } from '../shared/fs.js';
export async function runStatusCommand(input) {
    const knowledgeRoot = path.resolve(input.knowledgeRoot);
    const configSummary = loadConfig({
        knowledgeRoot,
        jobStorePath: path.join(knowledgeRoot, 'system', 'jobs', 'jobs.json'),
    });
    const requiredDirectories = await summarizeRequiredPaths(knowledgeRoot, defaultKnowledgeLayout);
    const requiredFiles = await summarizeRequiredPaths(knowledgeRoot, requiredKnowledgeFiles.map((file) => file.relativePath));
    const jobCountsByState = await readJobCounts(configSummary.jobStorePath);
    const jobCounts = { ...jobCountsByState };
    const readiness = requiredDirectories.missing.length === 0 && requiredFiles.missing.length === 0
        ? 'ready'
        : 'incomplete';
    return {
        knowledgeRoot,
        knowledgeRootExists: await exists(knowledgeRoot),
        readiness,
        configSummary,
        jobCounts,
        jobCountsByState,
        requiredDirectories,
        requiredFiles,
    };
}
async function summarizeRequiredPaths(knowledgeRoot, relativePaths) {
    const present = [];
    const missing = [];
    for (const relativePath of relativePaths) {
        const targetPath = path.join(knowledgeRoot, relativePath);
        if (await exists(targetPath)) {
            present.push(relativePath);
        }
        else {
            missing.push(relativePath);
        }
    }
    return { present, missing };
}
async function readJobCounts(jobStorePath) {
    try {
        const raw = await readFile(jobStorePath, 'utf8');
        const parsed = JSON.parse(raw);
        const counts = {};
        for (const job of Object.values(parsed.jobs ?? {})) {
            if (!job.status) {
                continue;
            }
            counts[job.status] = (counts[job.status] ?? 0) + 1;
        }
        return counts;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}
