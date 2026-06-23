import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { updateWikiIndex } from './index-log.js';
const GENERATED_BY = 'llm-wiki-semantic-overview';
const SOURCE_SECTION_HEADING = '自动主题综述';
export async function refreshSemanticOverviews(input) {
    const root = path.resolve(input.knowledgeRoot);
    const synthesesDirectory = path.join(root, 'wiki', 'syntheses');
    await mkdir(synthesesDirectory, { recursive: true });
    const sourcePages = await listSourcePages(root);
    const semanticPages = [
        ...await listSemanticPages(root, 'concepts'),
        ...await listSemanticPages(root, 'entities'),
    ];
    const desired = await resolveOverviewSlugCollisions(synthesesDirectory, buildOverviewPages(semanticPages, sourcePages));
    const existingGenerated = await listGeneratedOverviewSlugs(synthesesDirectory);
    const desiredSlugs = new Set(desired.map((page) => page.slug));
    const writtenFiles = new Set();
    const removedIndexEntries = [];
    let removedCount = 0;
    for (const slug of existingGenerated) {
        if (desiredSlugs.has(slug)) {
            continue;
        }
        const filePath = path.join(synthesesDirectory, `${slug}.md`);
        const existing = await readExisting(filePath);
        const title = existing ? extractTitle(existing) ?? titleFromSlug(slug) : titleFromSlug(slug);
        await rm(filePath, { force: true });
        writtenFiles.add(filePath);
        removedIndexEntries.push(formatIndexEntry({ slug, title }));
        removedCount += 1;
    }
    for (const page of desired) {
        const filePath = path.join(synthesesDirectory, `${page.slug}.md`);
        const markdown = formatOverviewMarkdown(page);
        const existing = await readExisting(filePath);
        if (existing !== markdown) {
            await writeFile(filePath, markdown, 'utf8');
            writtenFiles.add(filePath);
        }
    }
    const indexPath = await updateWikiIndex(root, {
        addEntries: desired.map(formatIndexEntry),
        removeEntries: removedIndexEntries,
    });
    writtenFiles.add(indexPath);
    for (const filePath of await refreshSourceOverviewLinks(root, desired)) {
        writtenFiles.add(filePath);
    }
    return {
        writtenFiles: [...writtenFiles].sort((left, right) => left.localeCompare(right)),
        overviewCount: desired.length,
        removedCount,
    };
}
async function listSemanticPages(root, section) {
    const directory = path.join(root, 'wiki', section);
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const pages = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'index.md') {
            continue;
        }
        const slug = path.basename(entry.name, '.md');
        const filePath = path.join(directory, entry.name);
        const markdown = await readFile(filePath, 'utf8');
        const sourceLinks = extractSourceLinks(markdown);
        if (sourceLinks.length === 0) {
            continue;
        }
        pages.push({
            section,
            slug,
            target: `${section}/${slug}`,
            title: extractTitle(markdown) ?? titleFromSlug(slug),
            filePath,
            sourceLinks,
            evidenceLines: extractEvidenceLines(markdown),
        });
    }
    return pages;
}
async function listSourcePages(root) {
    const directory = path.join(root, 'wiki', 'sources');
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const sources = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'index.md') {
            continue;
        }
        const slug = path.basename(entry.name, '.md');
        const filePath = path.join(directory, entry.name);
        const markdown = await readFile(filePath, 'utf8');
        sources.push({
            slug,
            target: `sources/${slug}`,
            title: extractTitle(markdown) ?? titleFromSlug(slug),
        });
    }
    return sources.sort((left, right) => left.slug.localeCompare(right.slug));
}
async function resolveOverviewSlugCollisions(synthesesDirectory, pages) {
    const reservedSlugs = new Set();
    const resolvedPages = [];
    for (const page of pages) {
        const slug = await chooseGeneratedOverviewSlug(synthesesDirectory, page.slug, reservedSlugs);
        reservedSlugs.add(slug);
        resolvedPages.push(slug === page.slug ? page : { ...page, slug });
    }
    return resolvedPages;
}
async function chooseGeneratedOverviewSlug(synthesesDirectory, baseSlug, reservedSlugs) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const slug = attempt === 0
            ? baseSlug
            : attempt === 1
                ? `${baseSlug}-generated`
                : `${baseSlug}-generated-${attempt}`;
        if (reservedSlugs.has(slug)) {
            continue;
        }
        const existing = await readExisting(path.join(synthesesDirectory, `${slug}.md`));
        if (!existing || isGeneratedOverviewMarkdown(existing)) {
            return slug;
        }
    }
    throw new Error(`Unable to choose generated semantic overview slug for ${baseSlug}`);
}
function buildOverviewPages(pages, sourcePages) {
    const groups = new Map();
    for (const page of pages) {
        const key = `${page.section}:${normalizeTitle(page.title)}`;
        groups.set(key, [...groups.get(key) ?? [], page]);
    }
    return [
        buildWikiOverviewPage(sourcePages, pages),
        ...[...groups.values()].map((group) => buildOverviewPage(group)),
    ]
        .filter((page) => page !== null)
        .sort((left, right) => left.slug.localeCompare(right.slug));
}
function buildWikiOverviewPage(sourcePages, semanticPages) {
    if (sourcePages.length < 2) {
        return null;
    }
    const conceptPages = semanticPages.filter((page) => page.section === 'concepts');
    const entityPages = semanticPages.filter((page) => page.section === 'entities');
    const sourceSlugs = sourcePages.map((source) => source.slug);
    return {
        slug: 'wiki-topic-overview',
        title: 'Wiki 资料总览',
        sourceSlugs,
        body: [
            '# Wiki 资料总览',
            '',
            '## 说明',
            '这是入库流程自动维护的 Obsidian 总览页。它只列出当前 wiki 已入库资料和可浏览知识入口，不自动生成未经人工确认的研究结论。',
            '',
            '## 已入库资料',
            ...sourcePages.map((source) => `- [[${source.target}|${source.title}]]`),
            '',
            '## 概念入口',
            ...(conceptPages.length > 0
                ? conceptPages.slice(0, 60).map((page) => `- [[${page.target}|${page.title}]]`)
                : ['- 暂无可稳定抽取的概念页。']),
            '',
            '## 实体入口',
            ...(entityPages.length > 0
                ? entityPages.slice(0, 60).map((page) => `- [[${page.target}|${page.title}]]`)
                : ['- 暂无可稳定抽取的实体页。']),
            '',
            '## 使用边界',
            '- 本页是可重建的导航页，不是人工批准的长期结论。',
            '- 回答问题时仍应以 query 返回的原文片段或 reading 原文为依据。',
        ].join('\n'),
    };
}
function buildOverviewPage(group) {
    const sourceLinks = dedupeSourceLinks(group.flatMap((page) => page.sourceLinks));
    if (sourceLinks.length < 2) {
        return null;
    }
    const representative = group[0];
    const kindLabel = representative.section === 'concepts' ? '概念' : '实体';
    const title = `${representative.title} 主题综述`;
    const slug = `${slugify(representative.title)}-${representative.section === 'concepts' ? 'concept' : 'entity'}-overview`;
    const semanticLinks = group
        .sort((left, right) => left.target.localeCompare(right.target))
        .map((page) => `- [[${page.target}|${page.title}]]`);
    const evidenceLines = group
        .flatMap((page) => page.evidenceLines.map((line) => `- [[${page.target}|${page.title}]]: ${line}`))
        .slice(0, 8);
    return {
        slug,
        title,
        sourceSlugs: sourceLinks.map((source) => source.slug),
        body: [
            `# ${title}`,
            '',
            '## 说明',
            `这是入库流程自动维护的${kindLabel}主题页。它只聚合同一主题下的来源、语义页和原文证据入口，不自动生成未经人工确认的结论。`,
            '',
            '## 涉及资料',
            ...sourceLinks.map((source) => `- [[sources/${source.slug}|${source.title}]]`),
            '',
            `## 相关${kindLabel}页`,
            ...semanticLinks,
            '',
            '## 证据摘录',
            ...(evidenceLines.length > 0 ? evidenceLines : ['- 证据请进入上方来源页和完整原文核对。']),
            '',
            '## 使用边界',
            '- 本页是可重建的导航/综述索引，不是人工批准的研究结论。',
            '- 如果需要长期稳定结论、路线总结或跨来源判断，应基于 query 证据包后再显式执行 synthesis promotion。',
        ].join('\n'),
    };
}
async function listGeneratedOverviewSlugs(synthesesDirectory) {
    let entries;
    try {
        entries = await readdir(synthesesDirectory, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const slugs = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
            continue;
        }
        const filePath = path.join(synthesesDirectory, entry.name);
        const markdown = await readFile(filePath, 'utf8');
        if (isGeneratedOverviewMarkdown(markdown)) {
            slugs.push(path.basename(entry.name, '.md'));
        }
    }
    return slugs;
}
function isGeneratedOverviewMarkdown(markdown) {
    return markdown.includes(`generatedBy: ${JSON.stringify(GENERATED_BY)}`);
}
async function refreshSourceOverviewLinks(root, overviews) {
    const sourceDirectory = path.join(root, 'wiki', 'sources');
    let entries;
    try {
        entries = await readdir(sourceDirectory, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
    const overviewEntriesBySource = new Map();
    for (const overview of overviews) {
        for (const sourceSlug of overview.sourceSlugs) {
            overviewEntriesBySource.set(sourceSlug, [
                ...(overviewEntriesBySource.get(sourceSlug) ?? []),
                `- [[syntheses/${overview.slug}|${overview.title}]]`,
            ]);
        }
    }
    const writtenFiles = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'index.md') {
            continue;
        }
        const slug = path.basename(entry.name, '.md');
        const filePath = path.join(sourceDirectory, entry.name);
        const markdown = await readFile(filePath, 'utf8');
        const updated = replaceManagedSection(markdown, SOURCE_SECTION_HEADING, overviewEntriesBySource.get(slug) ?? []);
        if (updated !== markdown) {
            await writeFile(filePath, updated, 'utf8');
            writtenFiles.push(filePath);
        }
    }
    return writtenFiles;
}
function replaceManagedSection(markdown, heading, entries) {
    const lines = markdown.trimEnd().split('\n');
    const headingLine = `## ${heading}`;
    const headingIndex = lines.findIndex((line) => line.trim() === headingLine);
    const normalizedEntries = [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))];
    if (headingIndex === -1) {
        if (normalizedEntries.length === 0) {
            return markdown;
        }
        return `${lines.join('\n')}\n\n${headingLine}\n${normalizedEntries.join('\n')}\n`;
    }
    const nextHeadingIndex = lines.findIndex((line, index) => index > headingIndex && /^##\s+/.test(line));
    const sectionEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
    const updated = normalizedEntries.length === 0
        ? [
            ...trimTrailingBlankLines(lines.slice(0, headingIndex)),
            ...lines.slice(sectionEnd),
        ]
        : [
            ...lines.slice(0, headingIndex + 1),
            ...normalizedEntries,
            ...lines.slice(sectionEnd),
        ];
    return `${trimTrailingBlankLines(updated).join('\n')}\n`;
}
function formatOverviewMarkdown(page) {
    const now = new Date().toISOString();
    return [
        '---',
        `title: ${JSON.stringify(page.title)}`,
        `created: ${JSON.stringify(now)}`,
        `updated: ${JSON.stringify(now)}`,
        'type: "synthesis"',
        'tags: []',
        'sources: []',
        'confidence: "medium"',
        'contested: false',
        `generatedBy: ${JSON.stringify(GENERATED_BY)}`,
        '---',
        page.body,
        '',
    ].join('\n');
}
function formatIndexEntry(page) {
    return `- [[syntheses/${page.slug}|${page.title}]]`;
}
function extractSourceLinks(markdown) {
    const links = [...markdown.matchAll(/\[\[sources\/([^|\]]+)\|([^\]]+)]]/g)]
        .map((match) => ({ slug: match[1], title: match[2].trim() }));
    return dedupeSourceLinks(links);
}
function dedupeSourceLinks(links) {
    const seen = new Set();
    const deduped = [];
    for (const link of links) {
        if (seen.has(link.slug)) {
            continue;
        }
        seen.add(link.slug);
        deduped.push(link);
    }
    return deduped.sort((left, right) => left.slug.localeCompare(right.slug));
}
function extractEvidenceLines(markdown) {
    const lines = markdown.split('\n');
    const evidenceIndex = lines.findIndex((line) => line.trim() === '## 证据');
    if (evidenceIndex === -1) {
        return [];
    }
    const nextHeadingIndex = lines.findIndex((line, index) => index > evidenceIndex && /^##\s+/.test(line));
    const sectionEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
    return lines
        .slice(evidenceIndex + 1, sectionEnd)
        .map((line) => line.trim().replace(/^[-*]\s*/, '').trim())
        .filter((line) => line.length > 0)
        .slice(0, 3);
}
function extractTitle(markdown) {
    const frontmatterTitle = markdown.match(/^---\n[\s\S]*?\ntitle:\s*"([^"]+)"\n[\s\S]*?\n---\n/u)?.[1];
    if (frontmatterTitle) {
        return frontmatterTitle;
    }
    return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}
async function readExisting(filePath) {
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
function titleFromSlug(slug) {
    return slug
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function slugify(value) {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug.length > 0 ? slug : 'semantic';
}
function trimTrailingBlankLines(lines) {
    const next = [...lines];
    while (next.length > 0 && next[next.length - 1].trim() === '') {
        next.pop();
    }
    return next;
}
