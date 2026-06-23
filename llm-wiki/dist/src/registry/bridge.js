import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadIndexedPages, parseIndexedTarget } from '../query/query.js';
import { exists, readJsonFile, writeJsonFile } from '../shared/fs.js';
import { normalizeWikiId, tokenize } from './helpers.js';
import { resolveRegistryPaths } from './paths.js';
import { readRegistryState, runRegistryInit } from './state.js';
const BRIDGE_LINK_RE = /llm-wiki:\/\/([^/\s)\]]+)\/([^\s)\]]+)/g;
export async function runBridgeIndex(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const targetsByWiki = new Map(state.wikis.map((entry) => [entry.id, entry]));
    const links = [];
    const renderedKeys = new Set();
    const edges = await readBridgeEdges(paths);
    const edgeByKey = new Map(edges.map((edge) => [edgeBridgeKey(edge), edge]));
    for (const wiki of state.wikis) {
        let indexedPages = [];
        try {
            indexedPages = await loadIndexedPages(wiki.knowledgeRoot);
        }
        catch {
            continue;
        }
        for (const page of indexedPages) {
            let content = '';
            try {
                content = await readFile(page.filePath, 'utf8');
            }
            catch {
                continue;
            }
            for (const match of content.matchAll(BRIDGE_LINK_RE)) {
                const toWikiId = normalizeWikiId(match[1] ?? '');
                const toTarget = normalizeRenderedTarget(match[2] ?? '');
                const entry = {
                    fromWikiId: wiki.id,
                    fromTarget: page.target,
                    fromFilePath: page.filePath,
                    toWikiId,
                    toTarget,
                    raw: `llm-wiki://${toWikiId}/${toTarget}`,
                    status: await renderedBridgeStatus(targetsByWiki, edgeByKey, {
                        fromWikiId: wiki.id,
                        fromTarget: page.target,
                        toWikiId,
                        toTarget,
                    }),
                    source: 'rendered-link',
                };
                links.push(entry);
                renderedKeys.add(renderedBridgeKey(entry));
            }
        }
    }
    for (const edge of edges) {
        const status = await bridgeEdgeStatus(targetsByWiki, edge);
        const edgeEntry = {
            fromWikiId: edge.fromWikiId,
            fromTarget: edge.fromTarget,
            fromFilePath: edge.fromFilePath,
            toWikiId: edge.toWikiId,
            toTarget: edge.toTarget,
            raw: edge.link,
            status,
            source: 'structured-edge',
            edgeId: edge.id,
        };
        if (status !== 'resolved' && !renderedKeys.has(renderedBridgeKey(edgeEntry))) {
            links.push(edgeEntry);
        }
        if (edge.fromFilePath && await exists(edge.fromFilePath)) {
            const sourceContent = await readFile(edge.fromFilePath, 'utf8');
            if (!sourceContent.includes(edge.link)) {
                const staleRenderedLinks = [...sourceContent.matchAll(BRIDGE_LINK_RE)]
                    .map((match) => ({
                    toWikiId: normalizeWikiId(match[1] ?? ''),
                    toTarget: normalizeRenderedTarget(match[2] ?? ''),
                }))
                    .filter((link) => link.toWikiId === edge.toWikiId && link.toTarget !== edge.toTarget);
                links.push({
                    ...edgeEntry,
                    status: staleRenderedLinks.length > 0 ? 'stale-edge' : 'unrendered-edge',
                });
            }
        }
    }
    const generatedAt = new Date().toISOString();
    const bridgeFile = path.join(paths.bridgesDirectory, 'cross-wiki-links.json');
    await writeJsonFile(bridgeFile, {
        version: 1,
        registryRoot: paths.root,
        generatedAt,
        links,
    });
    return {
        registryRoot: paths.root,
        generatedAt,
        linkCount: links.length,
        unresolvedCount: links.filter((link) => link.status !== 'resolved').length,
        bridgeFile,
        links,
    };
}
export async function runBridgeList(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const proposals = await readBridgeProposals(paths);
    return {
        registryRoot: paths.root,
        proposalCount: proposals.length,
        pendingCount: proposals.filter((proposal) => proposal.status === 'proposed').length,
        proposals,
    };
}
export async function runBridgeTargets(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const proposal = await readRequiredBridgeProposal(paths, input.proposalId);
    const targetWiki = findWiki(state, proposal.toWikiId);
    const sourceText = await bridgeProposalSearchText(proposal);
    const sourceTokens = new Set(tokenize(sourceText));
    const candidates = [];
    let indexedPages = [];
    try {
        indexedPages = await loadIndexedPages(targetWiki.knowledgeRoot);
    }
    catch {
        indexedPages = [];
    }
    for (const page of indexedPages) {
        let content = '';
        try {
            content = await readFile(page.filePath, 'utf8');
        }
        catch {
            continue;
        }
        const pageTokens = new Set(tokenize(`${page.title}\n${page.target}\n${content}`));
        const overlap = [...sourceTokens].filter((token) => pageTokens.has(token));
        const sourceRef = extractFrontmatterValue(content, 'sourceRef');
        const rawPath = extractFrontmatterValue(content, 'rawPath');
        const score = overlap.length + (page.section === 'sources' ? 1.5 : 0) + (sourceRef || rawPath ? 0.5 : 0);
        candidates.push({
            wikiId: targetWiki.id,
            target: page.target,
            title: page.title,
            filePath: page.filePath,
            link: `llm-wiki://${targetWiki.id}/${page.target}`,
            evidenceKind: page.section === 'sources' ? 'source-page' : 'wiki-page',
            sourceRef,
            rawPath,
            excerpt: excerptMarkdown(content),
            rationale: overlap.length > 0
                ? `与桥接理由共享关键词：${overlap.slice(0, 6).join(', ')}`
                : '可作为目标 wiki 内的候选页面；接受前需人工确认语义关系。',
            score,
            readiness: {
                status: 'unknown',
                indexStatus: indexedPages.length > 0 ? 'indexed' : 'missing-index',
            },
            diagnostics: indexedPages.length > 0 ? [] : ['目标 wiki 缺少 wiki/index.md 或索引不可读。'],
        });
    }
    const chunkState = await readChunkIndex(targetWiki.knowledgeRoot);
    const targetDiagnostics = [];
    if (indexedPages.length === 0) {
        targetDiagnostics.push('目标 wiki 缺少 wiki/index.md、索引为空，或索引不可读。');
    }
    if (!chunkState) {
        targetDiagnostics.push('目标 wiki 缺少 system/index/chunks.json v2；bridge-targets 已回退到页面级候选。');
    }
    if (chunkState) {
        for (const chunk of chunkState.chunks) {
            const chunkTokens = new Set(tokenize(`${chunk.pageTitle}\n${chunk.pageTarget}\n${chunk.heading}\n${chunk.text}`));
            const overlap = [...sourceTokens].filter((token) => chunkTokens.has(token));
            const score = overlap.length + (chunk.evidenceKind === 'raw' ? 2 : 0.5) + (chunk.metadata.section === 'sources' ? 1 : 0);
            if (score <= 0) {
                continue;
            }
            candidates.push({
                wikiId: targetWiki.id,
                target: chunk.pageTarget,
                title: chunk.pageTitle,
                filePath: chunk.filePath,
                link: `llm-wiki://${targetWiki.id}/${chunk.pageTarget}`,
                evidenceKind: chunk.evidenceKind === 'raw' ? 'source-page' : 'wiki-page',
                sourceRef: chunk.sourceRef,
                rawPath: chunk.rawPath ?? null,
                excerpt: excerptMarkdown(chunk.text),
                rationale: `原文片段与桥接理由共享关键词：${overlap.slice(0, 6).join(', ')}`,
                score,
                readiness: {
                    status: 'ready',
                    indexStatus: 'chunks-v2',
                },
                diagnostics: [],
            });
        }
    }
    return {
        registryRoot: paths.root,
        proposal,
        targetReadiness: {
            wikiId: targetWiki.id,
            status: chunkState ? 'ready' : indexedPages.length > 0 ? 'partial' : 'blocked',
            indexStatus: chunkState ? 'chunks-v2' : indexedPages.length > 0 ? 'page-index-only' : 'missing-index',
            diagnostics: candidates.length > 0
                ? targetDiagnostics
                : [...targetDiagnostics, '没有生成可供审核的目标候选；请创建 landing page、重建索引或重新选择目标 wiki。'],
        },
        candidates: dedupeTargetCandidates(candidates)
            .sort((left, right) => right.score - left.score || left.target.localeCompare(right.target))
            .slice(0, 12),
    };
}
export async function runBridgeAccept(input) {
    return acceptResolvedBridge(input);
}
export async function runBridgeCreateLanding(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const proposal = await readRequiredBridgeProposal(paths, input.proposalId);
    if (proposal.status !== 'proposed') {
        throw new Error(`bridge-accept requires a proposed bridge. Current status: ${proposal.status}`);
    }
    const targetWiki = findWiki(state, proposal.toWikiId);
    const section = normalizeTargetSegment(input.section ?? 'bridges', 'section');
    const slug = normalizeTargetSegment(input.slug, 'slug');
    const target = `${section}/${slug}`;
    const targetFile = path.join(targetWiki.knowledgeRoot, 'wiki', section, `${slug}.md`);
    if (await exists(targetFile)) {
        throw new Error(`Bridge landing page already exists: ${targetFile}. Use bridge-accept --target ${targetWiki.id}/${target} instead.`);
    }
    await mkdir(path.dirname(targetFile), { recursive: true });
    const title = titleFromTarget(slug);
    const sourceRef = proposal.sourcePageTarget ? `${proposal.fromWikiId}:${proposal.sourcePageTarget}` : proposal.fromWikiId;
    const now = new Date().toISOString();
    await writeFile(targetFile, [
        '---',
        `title: ${JSON.stringify(title)}`,
        `created: ${JSON.stringify(now)}`,
        `updated: ${JSON.stringify(now)}`,
        'type: "bridge"',
        'tags: ["cross-wiki-bridge"]',
        `sources: ${JSON.stringify([sourceRef])}`,
        'confidence: "medium"',
        'contested: false',
        '---',
        `# ${title}`,
        '',
        '## 跨 wiki 连接',
        '本页记录一个已批准的跨 wiki 关系，供 Obsidian 浏览和 registry bridge-index 校验。',
        '',
        '## 用途',
        '这是一个跨 wiki 连接落地页，用来说明另一个 wiki 中的材料为什么与当前 wiki 相关。',
        '',
        '## 来源',
        `- 来源 wiki：${proposal.fromWikiId}`,
        `- 来源页面：${sourceRef}`,
        '',
        '## 关系说明',
        proposal.rationale,
        '',
    ].join('\n'), 'utf8');
    await appendLandingToIndex(targetWiki.knowledgeRoot, target, title);
    const accepted = await acceptResolvedBridge({
        ...input,
        target: `${targetWiki.id}/${target}`,
    });
    return {
        ...accepted,
        landingPageFile: targetFile,
        files: [...accepted.files, targetFile],
    };
}
export async function runBridgeReject(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const proposal = await readRequiredBridgeProposal(paths, input.proposalId);
    if (proposal.status !== 'proposed') {
        throw new Error(`bridge-reject requires a proposed bridge. Current status: ${proposal.status}`);
    }
    if (!input.reviewer.trim()) {
        throw new Error('bridge-reject requires --reviewer <name>.');
    }
    if (!input.reason?.trim()) {
        throw new Error('bridge-reject requires --reason <reason>.');
    }
    const now = new Date().toISOString();
    const rejected = {
        ...proposal,
        status: 'rejected',
        reviewer: input.reviewer.trim(),
        reviewedAt: now,
        reason: input.reason.trim(),
        updatedAt: now,
    };
    await writeJsonFile(bridgeProposalFile(paths, rejected.id), rejected);
    return {
        registryRoot: paths.root,
        proposal: rejected,
        proposalFile: bridgeProposalFile(paths, rejected.id),
        files: [bridgeProposalFile(paths, rejected.id)],
    };
}
export async function createBridgeProposalsAfterRouteAccept(paths, proposal, ingestResult, primaryWikiId) {
    const sourcePageFile = ingestResult.writtenFiles.find((filePath) => filePath.replace(/\\/g, '/').includes('/wiki/sources/')) ?? null;
    const sourcePageTarget = sourcePageFile ? `sources/${path.basename(sourcePageFile, '.md')}` : null;
    const files = [];
    const now = new Date().toISOString();
    const secondaryWikis = proposal.classificationPackage.secondaryWikis
        .filter((secondary) => secondary.wikiId !== primaryWikiId && (secondary.relation === 'bridge' || secondary.relation === 'co-relevant'));
    for (const secondary of secondaryWikis) {
        const bridgeProposal = {
            id: `bridge-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
            status: 'proposed',
            routeProposalId: proposal.id,
            fromWikiId: primaryWikiId,
            toWikiId: secondary.wikiId,
            sourcePageTarget,
            sourcePageFile,
            suggestedLink: `llm-wiki://${secondary.wikiId}/<section>/<slug>`,
            rationale: secondary.rationale,
            reviewer: null,
            reviewedAt: null,
            reason: null,
            createdAt: now,
            updatedAt: now,
        };
        const file = bridgeProposalFile(paths, bridgeProposal.id);
        await writeJsonFile(file, bridgeProposal);
        files.push(file);
    }
    return files;
}
async function acceptResolvedBridge(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const proposal = await readRequiredBridgeProposal(paths, input.proposalId);
    if (proposal.status !== 'proposed') {
        throw new Error(`bridge-accept requires a proposed bridge. Current status: ${proposal.status}`);
    }
    if (!input.reviewer.trim()) {
        throw new Error('bridge-accept requires --reviewer <name> after human confirmation.');
    }
    if (!input.target?.trim()) {
        throw new Error('bridge-accept requires --target <wikiId>/<section>/<slug>. Accepted bridge edges must resolve to a real page.');
    }
    const target = await resolveBridgeTarget(state, proposal, input.target);
    const now = new Date().toISOString();
    const accepted = {
        ...proposal,
        status: 'accepted',
        toWikiId: target.wikiId,
        suggestedLink: target.link,
        reviewer: input.reviewer.trim(),
        reviewedAt: now,
        reason: input.reason ?? null,
        updatedAt: now,
    };
    const edge = {
        id: `edge-${accepted.id}`,
        proposalId: accepted.id,
        status: 'resolved',
        fromWikiId: accepted.fromWikiId,
        fromTarget: accepted.sourcePageTarget,
        fromFilePath: accepted.sourcePageFile,
        originalToWikiId: proposal.toWikiId,
        toWikiId: target.wikiId,
        toTarget: target.target,
        toFilePath: target.filePath,
        link: target.link,
        rationale: accepted.rationale,
        reviewer: accepted.reviewer ?? input.reviewer.trim(),
        reason: accepted.reason,
        decidedAt: now,
        renderedAt: null,
        retargeted: target.retargeted,
    };
    const files = [bridgeProposalFile(paths, accepted.id)];
    let renderedEdge = edge;
    if (accepted.sourcePageFile) {
        await appendBridgeLinkToSourcePage(accepted.sourcePageFile, target.link, accepted.rationale);
        renderedEdge = { ...edge, renderedAt: now };
        files.push(accepted.sourcePageFile);
    }
    const edgeFile = await upsertBridgeEdge(paths, renderedEdge);
    files.push(edgeFile);
    await writeJsonFile(bridgeProposalFile(paths, accepted.id), accepted);
    const decisionFile = path.join(paths.bridgeDecisionsDirectory, `${accepted.id}.json`);
    await writeJsonFile(decisionFile, {
        proposalId: accepted.id,
        status: 'accepted',
        reviewer: accepted.reviewer,
        reason: accepted.reason,
        decidedAt: now,
        originalSuggestedLink: proposal.suggestedLink,
        suggestedLink: accepted.suggestedLink,
        originalToWikiId: proposal.toWikiId,
        finalToWikiId: accepted.toWikiId,
        target: target.target,
        edgeId: renderedEdge.id,
        retargeted: target.retargeted,
    });
    files.push(decisionFile);
    return {
        registryRoot: paths.root,
        proposal: accepted,
        proposalFile: bridgeProposalFile(paths, accepted.id),
        edge: renderedEdge,
        edgeFile,
        decisionFile,
        files,
    };
}
async function readBridgeProposals(paths) {
    const entries = await readdir(paths.bridgeProposalsDirectory, { withFileTypes: true });
    const proposals = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const proposal = await readJsonFile(path.join(paths.bridgeProposalsDirectory, entry.name), null);
        if (proposal) {
            proposals.push(proposal);
        }
    }
    return proposals.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
async function readRequiredBridgeProposal(paths, proposalId) {
    const proposal = await readJsonFile(bridgeProposalFile(paths, proposalId), null);
    if (!proposal) {
        throw new Error(`Bridge proposal does not exist: ${proposalId}`);
    }
    return proposal;
}
function bridgeProposalFile(paths, proposalId) {
    return path.join(paths.bridgeProposalsDirectory, `${proposalId}.json`);
}
function bridgeEdgesFile(paths) {
    return path.join(paths.bridgesDirectory, 'edges.json');
}
async function readBridgeEdges(paths) {
    const store = await readJsonFile(bridgeEdgesFile(paths), null);
    return store?.edges ?? [];
}
async function upsertBridgeEdge(paths, edge) {
    const existing = await readBridgeEdges(paths);
    const next = existing.filter((candidate) => candidate.id !== edge.id);
    next.push(edge);
    await writeJsonFile(bridgeEdgesFile(paths), {
        version: 1,
        registryRoot: paths.root,
        updatedAt: new Date().toISOString(),
        edges: next.sort((left, right) => left.decidedAt.localeCompare(right.decidedAt) || left.id.localeCompare(right.id)),
    });
    return bridgeEdgesFile(paths);
}
async function resolveBridgeTarget(state, proposal, rawTarget) {
    const parsed = parseBridgeTarget(rawTarget);
    const wiki = findWiki(state, parsed.wikiId);
    const filePath = path.join(wiki.knowledgeRoot, 'wiki', `${parsed.target}.md`);
    if (!(await exists(filePath))) {
        throw new Error(`Bridge target page does not exist: ${filePath}`);
    }
    return {
        wiki,
        wikiId: wiki.id,
        target: parsed.target,
        filePath,
        link: `llm-wiki://${wiki.id}/${parsed.target}`,
        retargeted: wiki.id !== proposal.toWikiId,
    };
}
function parseBridgeTarget(rawTarget) {
    const trimmed = rawTarget.trim();
    if (!trimmed) {
        throw new Error('Bridge target cannot be empty.');
    }
    if (path.isAbsolute(trimmed) || trimmed.startsWith('/') || trimmed.includes('..')) {
        throw new Error(`Bridge target must be a registry URI target, not a file path: ${rawTarget}`);
    }
    let normalized = trimmed.replace(/\\/g, '/').replace(/\.md$/i, '');
    if (normalized.startsWith('llm-wiki://')) {
        normalized = normalized.slice('llm-wiki://'.length);
    }
    if (normalized.startsWith('wiki/')) {
        normalized = normalized.slice('wiki/'.length);
    }
    const parts = normalized.split('/').map((part) => part.trim()).filter(Boolean);
    if (parts[1] === 'wiki') {
        parts.splice(1, 1);
    }
    if (parts.length !== 3) {
        throw new Error('Bridge target must use <wikiId>/<section>/<slug>.');
    }
    for (const part of parts) {
        assertConcreteTargetSegment(part);
    }
    const wikiId = normalizeWikiId(parts[0]);
    const target = `${parts[1]}/${parts[2]}`;
    if (!parseIndexedTarget(target)) {
        throw new Error(`Bridge target section is not a supported wiki section: ${target}`);
    }
    return { wikiId, target };
}
function normalizeTargetSegment(raw, label) {
    const value = raw.trim().replace(/\.md$/i, '');
    assertConcreteTargetSegment(value);
    if (value.includes('/')) {
        throw new Error(`Bridge landing ${label} must be a single path segment.`);
    }
    return value;
}
function assertConcreteTargetSegment(segment) {
    if (!segment || segment === '.' || segment === '..' || segment.includes('<') || segment.includes('>')) {
        throw new Error(`Bridge target must name a concrete wiki page, not a placeholder: ${segment}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)) {
        throw new Error(`Bridge target segment contains unsupported characters: ${segment}`);
    }
}
function findWiki(state, wikiId) {
    const normalized = normalizeWikiId(wikiId);
    const wiki = state.wikis.find((entry) => entry.id === normalized);
    if (!wiki) {
        throw new Error(`Bridge target wiki is not registered: ${wikiId}`);
    }
    return wiki;
}
async function bridgeLinkStatus(targetsByWiki, toWikiId, toTarget) {
    if (toTarget.includes('<') || toTarget.includes('>')) {
        return 'placeholder-target';
    }
    const targetWiki = targetsByWiki.get(toWikiId);
    if (!targetWiki) {
        return 'unknown-wiki';
    }
    const targetFile = path.join(targetWiki.knowledgeRoot, 'wiki', `${toTarget}.md`);
    if (!(await exists(targetFile))) {
        return 'missing-page';
    }
    return 'resolved';
}
async function bridgeEdgeStatus(targetsByWiki, edge) {
    const status = await bridgeLinkStatus(targetsByWiki, edge.toWikiId, edge.toTarget);
    if (status !== 'resolved') {
        return status;
    }
    const targetWiki = targetsByWiki.get(edge.toWikiId);
    const currentTargetFile = targetWiki ? path.join(targetWiki.knowledgeRoot, 'wiki', `${edge.toTarget}.md`) : null;
    if (currentTargetFile && path.resolve(edge.toFilePath) !== path.resolve(currentTargetFile)) {
        return 'stale-edge';
    }
    return 'resolved';
}
function normalizeRenderedTarget(rawTarget) {
    return rawTarget.replace(/[.,;:]+$/g, '').replace(/\.md$/i, '');
}
function renderedBridgeKey(link) {
    return [link.fromWikiId, link.fromTarget ?? '', link.toWikiId, link.toTarget].join('\u0000');
}
function edgeBridgeKey(edge) {
    return [edge.fromWikiId, edge.fromTarget ?? '', edge.toWikiId, edge.toTarget].join('\u0000');
}
async function renderedBridgeStatus(targetsByWiki, edgeByKey, link) {
    const status = await bridgeLinkStatus(targetsByWiki, link.toWikiId, link.toTarget);
    if (status !== 'resolved') {
        return status;
    }
    return edgeByKey.has(renderedBridgeKey(link)) ? 'resolved' : 'orphan-rendered-link';
}
async function bridgeProposalSearchText(proposal) {
    let sourcePage = '';
    if (proposal.sourcePageFile && await exists(proposal.sourcePageFile)) {
        sourcePage = await readFile(proposal.sourcePageFile, 'utf8');
    }
    return [
        proposal.fromWikiId,
        proposal.toWikiId,
        proposal.sourcePageTarget ?? '',
        proposal.rationale,
        sourcePage,
    ].join('\n');
}
function excerptMarkdown(markdown) {
    return markdown
        .replace(/^---[\s\S]*?---\s*/m, '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 360);
}
function extractFrontmatterValue(markdown, key) {
    const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
}
async function readChunkIndex(knowledgeRoot) {
    const chunksFile = path.join(knowledgeRoot, 'system', 'index', 'chunks.json');
    const parsed = await readJsonFile(chunksFile, null);
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.chunks)) {
        return null;
    }
    return parsed;
}
function dedupeTargetCandidates(candidates) {
    const byTarget = new Map();
    for (const candidate of candidates) {
        const current = byTarget.get(candidate.target);
        if (!current || candidate.score > current.score || (candidate.evidenceKind === 'source-page' && current.evidenceKind !== 'source-page')) {
            byTarget.set(candidate.target, candidate);
        }
    }
    return [...byTarget.values()];
}
async function appendBridgeLinkToSourcePage(sourcePageFile, link, rationale) {
    const content = await readFile(sourcePageFile, 'utf8');
    if (content.includes(link)) {
        return;
    }
    const section = [
        '',
        '## 跨 wiki 连接',
        `- ${link} — ${rationale}`,
        '',
    ].join('\n');
    await appendFile(sourcePageFile, section, 'utf8');
}
async function appendLandingToIndex(knowledgeRoot, target, title) {
    const indexFile = path.join(knowledgeRoot, 'wiki', 'index.md');
    const link = `[[${target}|${title}]]`;
    const existing = await readFile(indexFile, 'utf8');
    if (existing.includes(link)) {
        return;
    }
    await appendFile(indexFile, `\n- ${link}\n`, 'utf8');
}
function titleFromTarget(slug) {
    return slug
        .split(/[-_]/g)
        .filter(Boolean)
        .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
        .join(' ');
}
