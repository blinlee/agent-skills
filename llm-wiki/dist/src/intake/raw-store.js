import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
const RAW_MANIFEST_RELATIVE_PATH = path.join('system', 'manifests', 'raw-sources.json');
export function hashRawBody(body) {
    return createHash('sha256').update(body).digest('hex');
}
export function formatManagedRawFile(input) {
    const capturedAt = input.capturedAt ?? new Date().toISOString();
    const frontmatter = {
        source_kind: input.sourceKind,
        source_ref: input.sourceRef,
        ingested: capturedAt,
        sha256: hashRawBody(input.body),
        immutable: 'true',
        job_id: input.jobId,
    };
    return [
        '---',
        ...Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
        '---',
        input.body,
    ].join('\n');
}
export function parseManagedRawFile(content) {
    if (!content.startsWith('---\n')) {
        return { hasManagedFrontmatter: false, frontmatter: {}, body: content };
    }
    const closingIndex = content.indexOf('\n---\n', 4);
    if (closingIndex === -1) {
        return { hasManagedFrontmatter: false, frontmatter: {}, body: content };
    }
    const rawFrontmatter = content.slice(4, closingIndex);
    const frontmatter = parseSimpleFrontmatter(rawFrontmatter);
    const hasManagedFrontmatter = Boolean(frontmatter.sha256 && frontmatter.ingested && frontmatter.immutable);
    return {
        hasManagedFrontmatter,
        frontmatter,
        body: hasManagedFrontmatter ? content.slice(closingIndex + '\n---\n'.length) : content,
    };
}
export function stripManagedRawFrontmatter(content) {
    return parseManagedRawFile(content).body;
}
export async function writeManagedRawFile(input) {
    const root = path.resolve(input.knowledgeRoot);
    validateRawRelativePath(input.relativePath);
    const targetPath = path.join(root, input.relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, formatManagedRawFile(input), 'utf8');
    await upsertRawManifestEntry(root, {
        relativePath: normalizeRelativePath(input.relativePath),
        sourceKind: input.sourceKind,
        sourceRef: input.sourceRef,
        jobId: input.jobId,
        sha256: hashRawBody(input.body),
        state: input.state,
        capturedAt: new Date().toISOString(),
    });
    return targetPath;
}
export async function moveManagedRawFile(input) {
    const root = path.resolve(input.knowledgeRoot);
    validateRawRelativePath(input.fromRelativePath);
    validateRawRelativePath(input.toRelativePath);
    const fromPath = path.join(root, input.fromRelativePath);
    const toPath = await resolveNonClobberingPath(path.join(root, input.toRelativePath));
    await mkdir(path.dirname(toPath), { recursive: true });
    await rename(fromPath, toPath);
    await withRawManifestWriteLock(root, async () => {
        const manifest = await readRawManifest(root);
        const oldKey = normalizeRelativePath(input.fromRelativePath);
        const oldEntry = manifest.entries[oldKey];
        const nextRelativePath = normalizeRelativePath(path.relative(root, toPath));
        const now = new Date().toISOString();
        if (!oldEntry) {
            return;
        }
        delete manifest.entries[oldKey];
        manifest.entries[nextRelativePath] = {
            ...oldEntry,
            relativePath: nextRelativePath,
            state: input.nextState,
            archivedAt: input.nextState === 'archived' ? now : oldEntry.archivedAt,
            rejectedAt: input.nextState === 'rejected' ? now : oldEntry.rejectedAt,
        };
        await writeRawManifest(root, manifest);
    });
    return toPath;
}
export async function readRawManifest(knowledgeRoot) {
    try {
        const raw = await readFile(path.join(path.resolve(knowledgeRoot), RAW_MANIFEST_RELATIVE_PATH), 'utf8');
        const parsed = JSON.parse(raw);
        return { entries: parsed.entries ?? {} };
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { entries: {} };
        }
        throw error;
    }
}
export async function writeRawManifest(knowledgeRoot, manifest) {
    const manifestPath = path.join(path.resolve(knowledgeRoot), RAW_MANIFEST_RELATIVE_PATH);
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
export function rawManifestRelativePath() {
    return RAW_MANIFEST_RELATIVE_PATH.replace(/\\/g, '/');
}
function parseSimpleFrontmatter(raw) {
    const result = {};
    for (const line of raw.split('\n')) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (!key) {
            continue;
        }
        try {
            result[key] = JSON.parse(value);
        }
        catch {
            result[key] = value.replace(/^['"]|['"]$/g, '');
        }
    }
    return result;
}
async function upsertRawManifestEntry(knowledgeRoot, entry) {
    await withRawManifestWriteLock(knowledgeRoot, async () => {
        const manifest = await readRawManifest(knowledgeRoot);
        manifest.entries[entry.relativePath] = entry;
        await writeRawManifest(knowledgeRoot, manifest);
    });
}
const rawManifestWriteQueues = new Map();
async function withRawManifestWriteLock(knowledgeRoot, operation) {
    const manifestPath = path.join(path.resolve(knowledgeRoot), RAW_MANIFEST_RELATIVE_PATH);
    const previousTail = rawManifestWriteQueues.get(manifestPath) ?? Promise.resolve();
    const result = previousTail.catch(() => undefined).then(operation);
    const nextTail = result.then(() => undefined, () => undefined);
    rawManifestWriteQueues.set(manifestPath, nextTail);
    try {
        return await result;
    }
    finally {
        if (rawManifestWriteQueues.get(manifestPath) === nextTail) {
            rawManifestWriteQueues.delete(manifestPath);
        }
    }
}
async function resolveNonClobberingPath(targetPath) {
    try {
        await readFile(targetPath);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return targetPath;
        }
        throw error;
    }
    const extension = path.extname(targetPath);
    const basePath = targetPath.slice(0, targetPath.length - extension.length);
    let counter = 2;
    while (true) {
        const candidate = `${basePath}-${counter}${extension}`;
        try {
            await readFile(candidate);
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return candidate;
            }
            throw error;
        }
        counter += 1;
    }
}
function validateRawRelativePath(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized.startsWith('raw/') || normalized.includes('../')) {
        throw new Error(`Invalid raw path: ${relativePath}`);
    }
}
function normalizeRelativePath(relativePath) {
    return path.posix.normalize(relativePath.replace(/\\/g, '/'));
}
