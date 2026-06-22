import { randomUUID } from 'node:crypto';
import { access, link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeStoredSuggestion } from './synthesis-normalization.js';
import { appendWikiLog, updateWikiIndex } from '../wiki/index-log.js';
export async function runSaveSynthesis(input) {
    const root = path.resolve(input.knowledgeRoot);
    const suggestionPath = path.join(root, 'review', 'queue', `${input.suggestionId}.json`);
    const mergeCandidatePath = path.join(root, 'review', 'merge-candidates', `${input.suggestionId}.json`);
    const suggestion = await readSuggestion(suggestionPath);
    if (suggestion.status !== 'reviewed' && !input.confirm) {
        throw new Error(`Synthesis suggestion ${input.suggestionId} must be reviewed or confirmed before promotion.`);
    }
    const promotionTarget = await resolvePromotionTarget(root, suggestion);
    await atomicWriteNewFile(promotionTarget.pagePath, buildPromotedMarkdown(suggestion), suggestion.id);
    const indexPath = await updateWikiIndex(root, [`- [[syntheses/${promotionTarget.slug}|${suggestion.title}]]`]);
    const logPath = await appendWikiLog(root, `save-synthesis\t${JSON.stringify({ suggestionId: suggestion.id, slug: promotionTarget.slug, confirm: Boolean(input.confirm) })}`);
    await appendSynthesisBacklinksToRelatedPages(root, suggestion, promotionTarget.slug);
    const promotedSuggestion = {
        ...suggestion,
        slug: promotionTarget.slug,
        status: 'promoted',
        promotedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pagePath: promotionTarget.pagePath,
    };
    await Promise.all([
        atomicWriteFile(suggestionPath, JSON.stringify(promotedSuggestion, null, 2)),
        atomicWriteFile(mergeCandidatePath, JSON.stringify(promotedSuggestion, null, 2)).catch((error) => {
            if (error.code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }),
    ]);
    return {
        promoted: true,
        suggestionId: suggestion.id,
        pagePath: promotionTarget.pagePath,
        indexPath,
        logPath,
    };
}
async function appendSynthesisBacklinksToRelatedPages(knowledgeRoot, suggestion, synthesisSlug) {
    const relatedTargets = new Set([
        ...suggestion.relatedPages,
        ...suggestion.citations.map((citation) => citation.target),
    ].filter((target) => /^(sources|entities|concepts)\//.test(target)));
    const backlink = `- [[syntheses/${synthesisSlug}|${suggestion.title}]]`;
    await Promise.all([...relatedTargets].map(async (target) => {
        const pagePath = path.join(knowledgeRoot, 'wiki', `${target}.md`);
        try {
            const content = await readFile(pagePath, 'utf8');
            await atomicWriteFile(pagePath, appendSectionEntry(content, 'Related syntheses', backlink));
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return undefined;
            }
            throw error;
        }
    }));
}
function appendSectionEntry(markdown, heading, entry) {
    const normalized = ensureTrailingNewline(markdown);
    const headingLine = `## ${heading}`;
    if (normalized.includes(entry)) {
        return normalized;
    }
    if (!normalized.includes(`\n${headingLine}\n`)) {
        return `${normalized.trimEnd()}\n\n${headingLine}\n${entry}\n`;
    }
    const sectionStart = normalized.indexOf(`\n${headingLine}\n`) + 1;
    const nextSectionStart = normalized.indexOf('\n## ', sectionStart + headingLine.length + 1);
    if (nextSectionStart === -1) {
        return `${normalized.trimEnd()}\n${entry}\n`;
    }
    return `${normalized.slice(0, nextSectionStart).trimEnd()}\n${entry}${normalized.slice(nextSectionStart)}`;
}
async function readSuggestion(suggestionPath) {
    const raw = await readFile(suggestionPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeStoredSuggestion(parsed);
}
function ensureTrailingNewline(value) {
    return value.endsWith('\n') ? value : `${value}\n`;
}
async function resolvePromotionTarget(knowledgeRoot, suggestion) {
    const requestedPath = buildSynthesisPagePath(knowledgeRoot, suggestion.slug);
    if (!(await fileExists(requestedPath)) || await pageBelongsToSuggestion(requestedPath, suggestion.id)) {
        return {
            slug: suggestion.slug,
            pagePath: requestedPath,
        };
    }
    const collisionSafeSlug = buildCollisionSafeSlug(suggestion.slug, suggestion.id);
    const collisionSafePath = buildSynthesisPagePath(knowledgeRoot, collisionSafeSlug);
    if (!(await fileExists(collisionSafePath)) || await pageBelongsToSuggestion(collisionSafePath, suggestion.id)) {
        return {
            slug: collisionSafeSlug,
            pagePath: collisionSafePath,
        };
    }
    throw new Error(`Cannot promote synthesis suggestion ${suggestion.id}: page slug collision for "${suggestion.slug}" also conflicts at "${collisionSafeSlug}".`);
}
function buildSynthesisPagePath(knowledgeRoot, slug) {
    return path.join(knowledgeRoot, 'wiki', 'syntheses', `${slug}.md`);
}
function buildCollisionSafeSlug(slug, suggestionId) {
    const uniqueSuffix = suggestionId.replace(/^synthesis-/, '');
    return slug.endsWith(`-${uniqueSuffix}`) ? slug : `${slug}-${uniqueSuffix}`;
}
async function fileExists(targetPath) {
    try {
        await access(targetPath);
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
async function pageBelongsToSuggestion(pagePath, suggestionId) {
    try {
        const content = await readFile(pagePath, 'utf8');
        return content.includes(`- Promotion source: ${suggestionId}`);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
function buildPromotedMarkdown(suggestion) {
    const groundingMeta = [
        `- Answerability: ${suggestion.grounding.answerability}`,
        `- Selected citations: ${suggestion.grounding.selectedCitationCount}`,
        `- Potential conflicts: ${suggestion.grounding.conflictCount}`,
        `- Claim-level citations: ${suggestion.grounding.claims.length}`,
    ].join('\n');
    const promotedMeta = [
        `- Promotion source: ${suggestion.id}`,
        `- Promotion status: ${suggestion.status === 'reviewed' ? 'reviewed' : 'confirmed'}`,
        `- Original question: ${suggestion.question}`,
        groundingMeta,
    ].join('\n');
    return suggestion.markdown.replace(/(^# .*\n\n)/, `$1${promotedMeta}\n\n`);
}
async function atomicWriteFile(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
}
async function atomicWriteNewFile(filePath, content, suggestionId) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    try {
        await link(tempPath, filePath);
    }
    catch (error) {
        if (error.code === 'EEXIST') {
            if (await pageBelongsToSuggestion(filePath, suggestionId)) {
                return;
            }
            throw new Error(`Cannot promote synthesis suggestion ${suggestionId}: final commit target already exists at "${filePath}" and promotion will not overwrite it.`);
        }
        throw error;
    }
    finally {
        await unlink(tempPath).catch((error) => {
            if (error.code === 'ENOENT') {
                return undefined;
            }
            throw error;
        });
    }
}
