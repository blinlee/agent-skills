import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { hashFileLike, hashParsedArtifactForDedup, hashSourceMetadata } from '../intake/fingerprint.js';
import { stripManagedRawFrontmatter } from '../intake/raw-store.js';
import { parseMarkdownSource } from '../parsers/markdown.js';
import { parseRepoSource } from '../parsers/repo.js';
import { parseTextSource } from '../parsers/text.js';
import { parseUrlSource } from '../parsers/url.js';
import { classifyUrlFailure, fetchCleanedUrlContent } from './url-source.js';
export async function parseSource(input) {
    if (input.sourceKind === 'md' || input.sourceKind === 'txt') {
        const readPath = input.stagedPath ?? input.input;
        const content = await readFile(readPath, 'utf8');
        const parserInput = {
            sourceId: input.sourceId,
            path: input.input,
            content: stripManagedRawFrontmatter(content),
        };
        return input.sourceKind === 'md'
            ? parseMarkdownSource(parserInput)
            : parseTextSource(parserInput);
    }
    if (input.sourceKind === 'repo') {
        return parseRepoSource({
            sourceId: input.sourceId,
            repoPath: input.input,
            maxSampleFiles: input.repoSampleLimit,
        });
    }
    return parseUrlSource({
        sourceId: input.sourceId,
        url: input.input,
    }, (url) => fetchCleanedUrlContent(url, input.urlFetchTimeoutMs));
}
export async function prepareSourceForDedup(input) {
    if (input.sourceKind === 'md' || input.sourceKind === 'txt') {
        return {
            fingerprint: await fingerprintSource(input.sourceKind, input.input),
            parsedArtifact: null,
        };
    }
    const parsedArtifact = await parseSource({
        sourceKind: input.sourceKind,
        input: input.input,
        sourceId: input.sourceId,
        stagedPath: input.stagedPath,
        urlFetchTimeoutMs: input.urlFetchTimeoutMs,
        repoSampleLimit: input.repoSampleLimit,
    });
    return {
        fingerprint: hashParsedArtifactForDedup(parsedArtifact),
        parsedArtifact,
    };
}
export function normalizeSourceIdentity(sourceKind, source) {
    return sourceKind === 'url' ? source.trim() : path.resolve(source);
}
export function buildStableSourceId(sourceKind, sourceIdentity) {
    return hashSourceMetadata({ sourceKind, sourceIdentity }).slice(0, 16);
}
export function resolveCollisionFreeSourceSlug(baseSlug, artifactId, otherEntries) {
    if (!isSourceSlugOwnedByOtherEntry(baseSlug, otherEntries)) {
        return baseSlug;
    }
    const suffix = artifactId.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 8) || 'source';
    const suffixedSlug = `${baseSlug}-${suffix}`;
    if (!isSourceSlugOwnedByOtherEntry(suffixedSlug, otherEntries)) {
        return suffixedSlug;
    }
    let counter = 2;
    while (isSourceSlugOwnedByOtherEntry(`${suffixedSlug}-${counter}`, otherEntries)) {
        counter += 1;
    }
    return `${suffixedSlug}-${counter}`;
}
export function resolveFinalStatus(hasReviewTriggers) {
    if (hasReviewTriggers) {
        return 'needs_review';
    }
    return 'completed';
}
export function isLocalFileCandidate(sourceKind) {
    return sourceKind === 'md' || sourceKind === 'txt' || sourceKind === 'unknown';
}
export async function findSemanticCurationSidecar(source) {
    const candidates = [
        `${source}.curation.json`,
        path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.curation.json`),
        path.join(path.dirname(source), '_curation', `${path.basename(source, path.extname(source))}.json`),
    ];
    return findFirstExistingPath(candidates);
}
export async function findInboxQualitySidecar(source) {
    const candidates = [
        `${source}.quality.json`,
        path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.quality.json`),
        path.join(path.dirname(source), '_quality', `${path.basename(source, path.extname(source))}.json`),
    ];
    return findFirstExistingPath(candidates);
}
export function resolveFailureStatus(sourceKind, error) {
    if (sourceKind === 'url' && classifyUrlFailure(error).retryable) {
        return 'failed_retryable';
    }
    return 'failed_terminal';
}
async function fingerprintSource(sourceKind, source) {
    if (sourceKind === 'md' || sourceKind === 'txt') {
        return hashFileLike(await readFile(source));
    }
    if (sourceKind === 'repo') {
        const fileStat = await stat(source);
        return hashSourceMetadata({
            kind: sourceKind,
            identity: normalizeSourceIdentity(sourceKind, source),
            size: fileStat.size,
            modifiedAt: fileStat.mtimeMs,
        });
    }
    return hashSourceMetadata({
        kind: sourceKind,
        identity: normalizeSourceIdentity(sourceKind, source),
    });
}
function isSourceSlugOwnedByOtherEntry(slug, otherEntries) {
    const sourcePagePath = path.posix.join('wiki', 'sources', `${slug}.md`);
    return otherEntries.some((entry) => entry.lastOutputManifest?.pageFiles.includes(sourcePagePath));
}
async function findFirstExistingPath(candidates) {
    for (const candidate of candidates) {
        if (await fileExists(candidate)) {
            return candidate;
        }
    }
    return null;
}
async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
