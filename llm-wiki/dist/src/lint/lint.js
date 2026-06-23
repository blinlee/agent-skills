import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashRawBody, parseManagedRawFile, readRawManifest } from '../intake/raw-store.js';
import { defaultKnowledgeLayout, requiredKnowledgeFiles, resolveKnowledgePaths } from '../paths.js';
import { loadIndexedPages, parseWikiLinks, parseIndexedTarget, resolveWikiLink } from '../wiki/links.js';
import { wikiSectionOrder } from '../wiki/sections.js';
import { exists, readJsonFile } from '../shared/fs.js';
export async function runLint(input) {
    const root = path.resolve(input.knowledgeRoot);
    const errors = [];
    const warnings = [];
    const checkedFiles = [];
    for (const directory of defaultKnowledgeLayout) {
        const targetPath = path.join(root, directory);
        checkedFiles.push(targetPath);
        if (!(await exists(targetPath))) {
            errors.push({
                type: 'error',
                code: 'missing-directory',
                message: `Required directory is missing: ${directory}`,
                path: targetPath,
            });
        }
    }
    for (const file of requiredKnowledgeFiles) {
        const targetPath = path.join(root, file.relativePath);
        checkedFiles.push(targetPath);
        if (!(await exists(targetPath))) {
            errors.push({
                type: 'error',
                code: 'missing-file',
                message: `Required file is missing: ${file.relativePath}`,
                path: targetPath,
            });
        }
    }
    const rawIssues = await lintRawIntegrity(root);
    checkedFiles.push(...rawIssues.checkedFiles);
    errors.push(...rawIssues.errors);
    warnings.push(...rawIssues.warnings);
    const taxonomyIssues = await lintTaxonomyGovernance(root);
    checkedFiles.push(...taxonomyIssues.checkedFiles);
    errors.push(...taxonomyIssues.errors);
    warnings.push(...taxonomyIssues.warnings);
    let indexedPages = [];
    if (!(errors.some((entry) => entry.code === 'missing-file' && entry.path?.endsWith(path.join('wiki', 'index.md'))))) {
        indexedPages = await loadIndexedPages(root);
    }
    const wikiFiles = await collectWikiMarkdownFiles(root);
    checkedFiles.push(...wikiFiles);
    const indexPath = path.join(root, 'wiki', 'index.md');
    const linkableWikiFiles = wikiFiles.filter((filePath) => !isReadingMirrorFile(root, filePath));
    const linkSourceFiles = (await exists(indexPath)) ? [indexPath, ...linkableWikiFiles] : linkableWikiFiles;
    const linkedTargets = new Set();
    const diskPages = wikiFiles
        .map((filePath) => toDiskPage(root, filePath))
        .filter((page) => page !== null);
    const pageByTarget = new Map(diskPages.map((page) => [page.target, page]));
    for (const filePath of linkSourceFiles) {
        const content = await readFile(filePath, 'utf8');
        for (const link of parseWikiLinks(content)) {
            const resolved = await resolveLintLink(root, link.rawTarget, indexedPages);
            if (!resolved || resolved.status === 'missing') {
                const indexedTarget = parseIndexedTarget(link.rawTarget);
                errors.push({
                    type: 'error',
                    code: 'missing-linked-page',
                    message: `Linked page does not resolve: ${link.rawTarget}`,
                    path: indexedTarget ? path.join(root, 'wiki', indexedTarget.section, `${indexedTarget.slug}.md`) : filePath,
                });
                continue;
            }
            if (resolved.status === 'ambiguous') {
                errors.push({
                    type: 'error',
                    code: 'ambiguous-linked-page',
                    message: `Linked page target is ambiguous: ${link.rawTarget} resolves to ${resolved.matches.map((match) => match.target).join(', ')}`,
                    path: filePath,
                });
                continue;
            }
            if (!(await exists(resolved.filePath))) {
                errors.push({
                    type: 'error',
                    code: 'missing-linked-page',
                    message: `Linked page is missing on disk: ${resolved.target}`,
                    path: resolved.filePath,
                });
                continue;
            }
            linkedTargets.add(resolved.target);
        }
    }
    const indexedTargets = new Set(indexedPages.map((page) => page.target));
    for (const page of pageByTarget.values()) {
        if (!indexedTargets.has(page.target)) {
            warnings.push({
                type: 'warning',
                code: 'missing-index-entry',
                message: `Wiki page is missing from wiki/index.md: ${page.target}`,
                path: page.filePath,
            });
        }
        if (!linkedTargets.has(page.target)) {
            warnings.push({
                type: 'warning',
                code: 'orphan-page',
                message: `Wiki page is not linked from index or other pages: ${page.target}`,
                path: page.filePath,
            });
        }
    }
    const wikiQualityIssues = await lintWikiPageQuality(wikiFiles);
    errors.push(...wikiQualityIssues.errors);
    warnings.push(...wikiQualityIssues.warnings);
    warnings.push(...lintScalingThresholds(indexedPages));
    return {
        status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'ok',
        errors,
        warnings,
        checkedFiles: [...new Set(checkedFiles)],
    };
}
function isReadingMirrorFile(root, filePath) {
    const relativePath = path.relative(path.join(root, 'wiki'), filePath).replace(/\\/g, '/');
    return /^readings\/[^/]+\.md$/u.test(relativePath);
}
async function lintTaxonomyGovernance(root) {
    const paths = resolveKnowledgePaths(root);
    const checkedFiles = [paths.taxonomyCategoryGraph, paths.taxonomyRedirects];
    const errors = [];
    const warnings = [];
    const graph = await readJsonFile(paths.taxonomyCategoryGraph, { nodes: [], edges: [] });
    const edges = (graph.edges ?? []).filter((edge) => typeof edge.from === 'string' && typeof edge.to === 'string');
    const canonicalEdges = edges.filter((edge) => edge.status === undefined || edge.status === 'accepted');
    for (const edge of canonicalEdges) {
        if (!edge.type) {
            warnings.push({
                type: 'warning',
                code: 'taxonomy-edge-missing-type',
                message: `Taxonomy edge ${edge.from} -> ${edge.to} lacks an explicit relationship type.`,
                path: paths.taxonomyCategoryGraph,
            });
        }
    }
    const hierarchyEdges = canonicalEdges.filter((edge) => ['is-a', 'part-of', 'subcategory-of', 'parent'].includes(String(edge.type ?? '')));
    const cycle = findDirectedCycle(hierarchyEdges.map((edge) => [edge.from, edge.to]));
    if (cycle.length > 0) {
        errors.push({
            type: 'error',
            code: 'taxonomy-cycle',
            message: `Taxonomy category graph contains a directed cycle: ${cycle.join(' -> ')}`,
            path: paths.taxonomyCategoryGraph,
        });
    }
    const redirects = await readJsonFile(paths.taxonomyRedirects, { redirects: {} });
    const redirectEntries = Object.entries(redirects.redirects ?? {});
    for (const [from, to] of redirectEntries) {
        if (!from.trim() || !to.trim()) {
            errors.push({
                type: 'error',
                code: 'taxonomy-empty-redirect',
                message: 'Taxonomy redirect keys and targets must be non-empty.',
                path: paths.taxonomyRedirects,
            });
        }
        if (from === to) {
            errors.push({
                type: 'error',
                code: 'taxonomy-self-redirect',
                message: `Taxonomy redirect points to itself: ${from}`,
                path: paths.taxonomyRedirects,
            });
        }
    }
    const redirectCycle = findRedirectCycle(redirects.redirects ?? {});
    if (redirectCycle.length > 0) {
        errors.push({
            type: 'error',
            code: 'taxonomy-redirect-cycle',
            message: `Taxonomy redirects contain a cycle: ${redirectCycle.join(' -> ')}`,
            path: paths.taxonomyRedirects,
        });
    }
    return { checkedFiles, errors, warnings };
}
function findDirectedCycle(edges) {
    const graph = new Map();
    for (const [from, to] of edges) {
        graph.set(from, [...(graph.get(from) ?? []), to]);
    }
    const visiting = new Set();
    const visited = new Set();
    const stack = [];
    const visit = (node) => {
        if (visiting.has(node)) {
            const index = stack.indexOf(node);
            return index >= 0 ? [...stack.slice(index), node] : [node, node];
        }
        if (visited.has(node)) {
            return [];
        }
        visiting.add(node);
        stack.push(node);
        for (const next of graph.get(node) ?? []) {
            const cycle = visit(next);
            if (cycle.length > 0) {
                return cycle;
            }
        }
        stack.pop();
        visiting.delete(node);
        visited.add(node);
        return [];
    };
    for (const node of graph.keys()) {
        const cycle = visit(node);
        if (cycle.length > 0) {
            return cycle;
        }
    }
    return [];
}
function findRedirectCycle(redirects) {
    return findDirectedCycle(Object.entries(redirects));
}
async function lintRawIntegrity(root) {
    const errors = [];
    const warnings = [];
    const checkedFiles = [];
    const manifest = await readRawManifest(root);
    const rawFiles = await collectManagedRawFiles(root);
    const manifestEntriesByPath = new Map(Object.entries(manifest.entries));
    checkedFiles.push(...rawFiles);
    for (const [relativePath, entry] of manifestEntriesByPath.entries()) {
        const absolutePath = path.join(root, relativePath);
        checkedFiles.push(absolutePath);
        if (!(await exists(absolutePath))) {
            errors.push({
                type: 'error',
                code: 'missing-raw-source',
                message: `Raw manifest entry is missing on disk: ${relativePath}`,
                path: absolutePath,
            });
            continue;
        }
        const parsed = parseManagedRawFile(await readFile(absolutePath, 'utf8'));
        const actualHash = hashRawBody(parsed.body);
        if (actualHash !== entry.sha256) {
            errors.push({
                type: 'error',
                code: 'raw-source-drift',
                message: `Raw source hash differs from manifest: ${relativePath}`,
                path: absolutePath,
            });
        }
    }
    for (const filePath of rawFiles) {
        const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
        const parsed = parseManagedRawFile(await readFile(filePath, 'utf8'));
        if (!parsed.hasManagedFrontmatter) {
            warnings.push({
                type: 'warning',
                code: 'raw-missing-frontmatter',
                message: `Managed raw source lacks sha256 frontmatter: ${relativePath}`,
                path: filePath,
            });
            continue;
        }
        const actualHash = hashRawBody(parsed.body);
        if (parsed.frontmatter.sha256 !== actualHash) {
            errors.push({
                type: 'error',
                code: 'raw-source-drift',
                message: `Raw source hash differs from frontmatter: ${relativePath}`,
                path: filePath,
            });
        }
        if (!manifestEntriesByPath.has(relativePath)) {
            warnings.push({
                type: 'warning',
                code: 'raw-missing-manifest-entry',
                message: `Managed raw source is not recorded in system/manifests/raw-sources.json: ${relativePath}`,
                path: filePath,
            });
        }
    }
    return { checkedFiles: [...new Set(checkedFiles)], errors, warnings };
}
async function collectManagedRawFiles(root) {
    const rawRoot = path.join(root, 'raw');
    const results = [];
    for (const directory of ['staged', 'archive']) {
        const directoryPath = path.join(rawRoot, directory);
        if (!(await exists(directoryPath))) {
            continue;
        }
        results.push(...await collectFilesRecursively(directoryPath));
    }
    return results.sort((left, right) => left.localeCompare(right));
}
async function collectFilesRecursively(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            return collectFilesRecursively(entryPath);
        }
        return entry.isFile() ? [entryPath] : [];
    }));
    return files.flat();
}
async function lintWikiPageQuality(wikiFiles) {
    const errors = [];
    const warnings = [];
    const titleOwners = new Map();
    for (const filePath of wikiFiles) {
        const content = await readFile(filePath, 'utf8');
        const frontmatter = parseWikiFrontmatter(content);
        const pageTitle = extractWikiTitle(content, frontmatter);
        if (pageTitle) {
            const key = `${resolveWikiPageKind(filePath, frontmatter)}:${pageTitle.toLowerCase()}`;
            titleOwners.set(key, [...(titleOwners.get(key) ?? []), filePath]);
        }
        if (!frontmatter) {
            warnings.push({
                type: 'warning',
                code: 'missing-frontmatter',
                message: 'Wiki page lacks required frontmatter for auditability.',
                path: filePath,
            });
        }
        else {
            for (const field of ['title', 'created', 'updated', 'type', 'tags', 'sources']) {
                if (!(field in frontmatter)) {
                    warnings.push({
                        type: 'warning',
                        code: 'missing-frontmatter-field',
                        message: `Wiki page frontmatter is missing field: ${field}`,
                        path: filePath,
                    });
                }
            }
            const confidence = String(frontmatter.confidence ?? '').toLowerCase();
            if (confidence === 'low') {
                warnings.push({
                    type: 'warning',
                    code: 'low-confidence-page',
                    message: 'Low-confidence wiki page should be reviewed before downstream synthesis.',
                    path: filePath,
                });
            }
            if (frontmatter.contested === true || String(frontmatter.contested).toLowerCase() === 'true') {
                warnings.push({
                    type: 'warning',
                    code: 'contested-page',
                    message: 'Contested wiki page has unresolved contradictions.',
                    path: filePath,
                });
            }
            const sourceCount = Array.isArray(frontmatter.sources) ? frontmatter.sources.length : 0;
            if (sourceCount <= 1 && !frontmatter.confidence) {
                warnings.push({
                    type: 'warning',
                    code: 'single-source-without-confidence',
                    message: 'Single-source page should explicitly set confidence.',
                    path: filePath,
                });
            }
        }
        const lineCount = content.split('\n').length;
        if (lineCount > 220 && resolveWikiPageKind(filePath, frontmatter) !== 'reading') {
            warnings.push({
                type: 'warning',
                code: 'oversized-page',
                message: `Wiki page has ${lineCount} lines and should be split for scanability.`,
                path: filePath,
            });
        }
    }
    for (const [titleKey, owners] of titleOwners.entries()) {
        if (owners.length <= 1) {
            continue;
        }
        const title = titleKey.slice(titleKey.indexOf(':') + 1);
        for (const owner of owners) {
            warnings.push({
                type: 'warning',
                code: 'duplicate-page-title',
                message: `Multiple wiki pages share the same title: ${title}`,
                path: owner,
            });
        }
    }
    return { errors, warnings };
}
function resolveWikiPageKind(filePath, frontmatter) {
    const frontmatterType = String(frontmatter?.type ?? '').trim().toLowerCase();
    if (frontmatterType) {
        return frontmatterType;
    }
    return path.basename(path.dirname(filePath)).toLowerCase();
}
function extractWikiTitle(content, frontmatter) {
    const frontmatterTitle = String(frontmatter?.title ?? '').trim();
    if (frontmatterTitle) {
        return frontmatterTitle;
    }
    const heading = content.match(/^#\s+(.+)$/m);
    return heading?.[1]?.trim() || null;
}
function lintScalingThresholds(indexedPages) {
    const warnings = [];
    const bySection = new Map();
    for (const page of indexedPages) {
        bySection.set(page.section, (bySection.get(page.section) ?? 0) + 1);
    }
    for (const [section, count] of bySection.entries()) {
        if (count > 50) {
            warnings.push({
                type: 'warning',
                code: 'large-index-section',
                message: `Index section ${section} has ${count} entries; split by subdomain or first letter.`,
            });
        }
    }
    if (indexedPages.length > 100) {
        warnings.push({
            type: 'warning',
            code: 'large-wiki-retrieval-needed',
            message: `Wiki has ${indexedPages.length} indexed pages; use content search/RAG-style retrieval before answering broad queries.`,
        });
    }
    if (indexedPages.length > 200) {
        warnings.push({
            type: 'warning',
            code: 'topic-map-needed',
            message: 'Wiki index exceeds 200 pages; create wiki/_meta/topic-map.md or equivalent thematic map.',
        });
    }
    return warnings;
}
function parseWikiFrontmatter(content) {
    if (!content.startsWith('---\n')) {
        return null;
    }
    const closingIndex = content.indexOf('\n---\n', 4);
    if (closingIndex === -1) {
        return null;
    }
    const result = {};
    for (const line of content.slice(4, closingIndex).split('\n')) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        try {
            result[key] = JSON.parse(value);
        }
        catch {
            if (value === 'true') {
                result[key] = true;
            }
            else if (value === 'false') {
                result[key] = false;
            }
            else {
                result[key] = value.replace(/^['\"]|['\"]$/g, '');
            }
        }
    }
    return result;
}
async function resolveLintLink(root, rawTarget, indexedPages) {
    const indexedMatch = resolveWikiLink(rawTarget, indexedPages);
    if (indexedMatch.status === 'resolved') {
        return {
            status: 'resolved',
            target: indexedMatch.page.target,
            filePath: indexedMatch.page.filePath,
        };
    }
    if (indexedMatch.status === 'ambiguous') {
        return {
            status: 'ambiguous',
            matches: indexedMatch.matches.map((match) => ({
                target: match.target,
                filePath: match.filePath,
            })),
        };
    }
    const parsedTarget = parseIndexedTarget(rawTarget);
    if (!parsedTarget) {
        return { status: 'missing' };
    }
    const filePath = path.join(root, 'wiki', parsedTarget.section, `${parsedTarget.slug}.md`);
    return {
        status: 'resolved',
        target: parsedTarget.target,
        filePath,
    };
}
function toDiskPage(root, filePath) {
    const relativePath = path.relative(path.join(root, 'wiki'), filePath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const parsedTarget = parseIndexedTarget(normalizedPath.replace(/\.md$/i, ''));
    if (!parsedTarget) {
        return null;
    }
    return {
        target: parsedTarget.target,
        filePath,
    };
}
async function collectWikiMarkdownFiles(root) {
    const wikiRoot = path.join(root, 'wiki');
    if (!(await exists(wikiRoot))) {
        return [];
    }
    const results = [];
    for (const section of wikiSectionOrder) {
        const sectionPath = path.join(wikiRoot, section);
        if (!(await exists(sectionPath))) {
            continue;
        }
        const entries = await readdir(sectionPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md') {
                results.push(path.join(sectionPath, entry.name));
            }
        }
    }
    return results.sort((left, right) => left.localeCompare(right));
}
