import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDedupStore } from '../intake/dedup-store.js';
import { backfillDedupManifestPageSnapshots } from '../intake/manifest-migration.js';
import { readRawManifest, stripManagedRawFrontmatter } from '../intake/raw-store.js';
import { createParsedArtifact, deriveTitleFromText } from '../parsers/base.js';
import { parseMarkdownSource } from '../parsers/markdown.js';
import { parseTextSource } from '../parsers/text.js';
import { writeKnowledgeChanges } from '../wiki/page-writer.js';
import { applySourceSemanticLinks, pruneMissingSourceSemanticLinks } from '../wiki/semantic-links.js';
export async function backfillIncompleteWikiAssets(input) {
    const knowledgeRoot = path.resolve(input.knowledgeRoot);
    const dedupManifestPath = path.join(knowledgeRoot, 'system', 'dedup', 'manifest.json');
    await backfillDedupManifestPageSnapshots({ knowledgeRoot, manifestPath: dedupManifestPath });
    const dedupStore = createDedupStore(dedupManifestPath);
    const rawManifest = await readRawManifest(knowledgeRoot);
    const entries = await dedupStore.list();
    const writtenFiles = [];
    const warnings = [];
    let checkedEntries = 0;
    let backfilledEntries = 0;
    let skippedEntries = 0;
    for (const entry of entries) {
        if (!entry.lastOutputManifest) {
            continue;
        }
        checkedEntries += 1;
        if (!needsReadingBackfill(entry.lastOutputManifest)) {
            continue;
        }
        const sourceSlug = sourceSlugFromManifest(entry.lastOutputManifest);
        if (!sourceSlug) {
            skippedEntries += 1;
            warnings.push(`backfill skipped ${entry.identity}: no source page in output manifest`);
            continue;
        }
        const rawEntry = findRawEntryForDedupEntry(entry, Object.values(rawManifest.entries));
        if (!rawEntry || rawEntry.sourceKind === 'unknown') {
            skippedEntries += 1;
            warnings.push(`backfill skipped ${entry.identity}: no matching managed raw archive`);
            continue;
        }
        try {
            const rawPath = path.join(knowledgeRoot, rawEntry.relativePath);
            const rawBody = stripManagedRawFrontmatter(await readFile(rawPath, 'utf8'));
            const parsedArtifact = await parseBackfillArtifact({
                rawEntry: rawEntry,
                rawBody,
            });
            const sourcePage = {
                slug: sourceSlug,
                title: parsedArtifact.title,
                artifactId: parsedArtifact.id,
                topics: [],
                backlinks: [],
                body: '',
            };
            const readingPage = {
                slug: sourceSlug,
                title: `${parsedArtifact.title} - 完整原文`,
                artifactId: parsedArtifact.id,
                topics: [],
                backlinks: [`sources/${sourceSlug}`],
                body: buildReadingPageBody(parsedArtifact, sourcePage),
            };
            sourcePage.body = await buildBackfillSourcePageBody({
                knowledgeRoot,
                sourcePage,
                generatedSourceBody: buildMinimalSourcePageBody(parsedArtifact, readingPage),
                readingPage,
            });
            const writeResult = await writeKnowledgeChanges({
                knowledgeRoot,
                sourcePage,
                readingPage,
                entityPages: [],
                conceptPages: [],
                synthesisPages: [],
                logEntry: `${new Date().toISOString()}\tmaintain-backfill\t${parsedArtifact.id}\t${sourcePage.slug}`,
                indexEntries: [
                    `- [[sources/${sourcePage.slug}|${sourcePage.title}]]`,
                    `- [[readings/${readingPage.slug}|${readingPage.title}]]`,
                ],
                previousOutputManifest: entry.lastOutputManifest,
            });
            const semanticLinkResult = await applySourceSemanticLinks({
                knowledgeRoot,
                source: {
                    slug: sourcePage.slug,
                    title: sourcePage.title,
                },
            });
            const semanticPruneResult = await pruneMissingSourceSemanticLinks(knowledgeRoot);
            writtenFiles.push(...writeResult.writtenFiles, ...semanticLinkResult.writtenFiles, ...semanticPruneResult.writtenFiles);
            await dedupStore.recordSuccess({
                identity: entry.identity,
                sourceKind: entry.sourceKind,
                fingerprint: entry.lastFingerprint,
                jobId: entry.lastSuccessfulJobId ?? `maintain-backfill-${parsedArtifact.id}`,
                status: entry.lastStatus ?? 'completed',
                outputManifest: preserveReviewFiles(writeResult.outputManifest, entry.lastOutputManifest),
            });
            backfilledEntries += 1;
        }
        catch (error) {
            skippedEntries += 1;
            warnings.push(`backfill failed ${entry.identity}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return {
        status: warnings.length > 0 ? 'partial' : 'ready',
        checkedEntries,
        backfilledEntries,
        skippedEntries,
        writtenFiles,
        warnings,
    };
}
function needsReadingBackfill(manifest) {
    const sourceSlug = sourceSlugFromManifest(manifest);
    return Boolean(sourceSlug && !manifest.pageFiles.includes(`wiki/readings/${sourceSlug}.md`));
}
function sourceSlugFromManifest(manifest) {
    for (const filePath of manifest.pageFiles) {
        const match = /^wiki\/sources\/([a-z0-9-]+)\.md$/u.exec(filePath.replace(/\\/g, '/'));
        if (match) {
            return match[1];
        }
    }
    return null;
}
function findRawEntryForDedupEntry(entry, rawEntries) {
    const candidates = rawEntries
        .filter((rawEntry) => rawEntry.state !== 'rejected')
        .filter((rawEntry) => rawEntry.sourceKind === entry.sourceKind)
        .filter((rawEntry) => sourceRefsMatch(entry, rawEntry))
        .sort((left, right) => rawEntryTime(right).localeCompare(rawEntryTime(left)));
    return candidates[0] ?? null;
}
function sourceRefsMatch(entry, rawEntry) {
    if (entry.sourceKind === 'url') {
        return rawEntry.sourceRef.trim() === entry.identity;
    }
    return rawEntry.sourceRef === entry.identity || path.resolve(rawEntry.sourceRef) === entry.identity;
}
function rawEntryTime(entry) {
    return entry.archivedAt ?? entry.capturedAt ?? '';
}
async function parseBackfillArtifact(input) {
    const sourceId = createHash('sha256')
        .update(`${input.rawEntry.sourceKind}:${input.rawEntry.sourceRef}:${input.rawEntry.sha256}`)
        .digest('hex')
        .slice(0, 16);
    const parsedAt = input.rawEntry.archivedAt ?? input.rawEntry.capturedAt;
    if (input.rawEntry.sourceKind === 'md') {
        return parseMarkdownSource({
            sourceId,
            path: input.rawEntry.sourceRef,
            content: input.rawBody,
            parsedAt,
        });
    }
    if (input.rawEntry.sourceKind === 'txt') {
        return parseTextSource({
            sourceId,
            path: input.rawEntry.sourceRef,
            content: input.rawBody,
            parsedAt,
        });
    }
    return createParsedArtifact({
        kind: input.rawEntry.sourceKind,
        sourceId,
        path: input.rawEntry.sourceRef,
        body: input.rawBody,
        title: deriveTitleFromText(input.rawBody, input.rawEntry.sourceRef),
        parser: 'maintain-backfill',
        parsedAt,
    });
}
async function buildBackfillSourcePageBody(input) {
    const sourcePath = path.join(input.knowledgeRoot, 'wiki', 'sources', `${input.sourcePage.slug}.md`);
    const existingBody = await readExistingFile(sourcePath);
    if (!existingBody) {
        return input.generatedSourceBody;
    }
    const links = [
        `- [[readings/${input.readingPage.slug}|完整原文]]`,
    ];
    const missingLinks = links.filter((link) => !existingBody.includes(link));
    if (missingLinks.length === 0) {
        return existingBody.trimEnd();
    }
    return [
        existingBody.trimEnd(),
        '',
        '## 维护补齐入口',
        ...missingLinks,
    ].join('\n');
}
function buildMinimalSourcePageBody(artifact, readingPage) {
    return [
        `# ${artifact.title}`,
        '',
        `- 资料 ID: ${artifact.id}`,
        `- 来源类型: ${sourceKindLabel(artifact.sourceKind)}`,
        `- 来源引用: ${artifact.sourceRef}`,
        '- 语义整理: 未补齐；maintain 只补完整原文入口，不生成概念/实体/综合页。',
        '',
        '## 原文入口',
        `- [[readings/${readingPage.slug}|完整原文]]`,
        `- ${formatExternalSourceLink(artifact.sourceRef, '打开原始来源')}`,
        '',
        '## 说明',
        '这是维护流程为旧资料补齐的资料卡入口。概念、实体、综合页必须由 semantic curation plan 创建；runtime 不根据标题、关键词或规则自动生成语义页。',
        '',
        '## 原文摘录',
        artifact.content.slice(0, 1200),
    ].join('\n');
}
function buildReadingPageBody(artifact, sourcePage) {
    return [
        `# ${artifact.title}`,
        '',
        `- 资料 ID: ${artifact.id}`,
        `- 来源类型: ${sourceKindLabel(artifact.sourceKind)}`,
        `- 来源引用: ${artifact.sourceRef}`,
        `- 来源卡片: [[sources/${sourcePage.slug}|${sourcePage.title}]]`,
        '',
        '## 说明',
        '这是入库/维护流程生成的 Obsidian 阅读镜像，用于直接阅读完整正文和参与本地链接导航。raw/objects、raw/staged 或 raw/archive 中的受管材料仍是保真证据；不要编辑本页来修正原始证据。',
        '',
        '## 原文全文',
        '',
        artifact.content.trim(),
    ].join('\n').trimEnd();
}
function formatExternalSourceLink(sourceRef, label) {
    return `[${label}](<${sourceRef}>)`;
}
function sourceKindLabel(sourceKind) {
    const labels = {
        md: 'Markdown',
        txt: '文本',
        url: '网页',
        repo: '代码仓库',
    };
    return labels[sourceKind];
}
async function readExistingFile(filePath) {
    try {
        return await readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
function preserveReviewFiles(current, previous) {
    return {
        ...current,
        reviewFiles: previous.reviewFiles ?? [],
    };
}
