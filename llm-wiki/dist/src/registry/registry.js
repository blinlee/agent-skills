import { createHash, randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runIngestJob } from '../jobs/job-runner.js';
import { loadIndexedPages } from '../query/query.js';
import { runQuery } from '../query/query.js';
import { ensureKnowledgeRootLayout } from '../paths.js';
const REGISTRY_DIRECTORIES = [
    'registry',
    'registry/profiles',
    'registry/profiles/proposals',
    'registry/profiles/decisions',
    'registry/classification/packages',
    'registry/routing/proposals',
    'registry/routing/decisions',
    'registry/bridges',
    'registry/bridges/proposals',
    'registry/bridges/decisions',
    'raw/inbox',
    'raw/objects',
    'wikis',
    'system/intake/items',
    'system/intake/spool',
    'system/intake/locks',
    'system/index',
    'system/rag',
];
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'what', 'with', 'this', 'that', 'into', 'about',
    'can', 'do', 'does', 'our', 'their', 'these', 'those', 'use', 'used', 'using', 'we', 'you',
]);
const CLASSIFICATION_TOPIC_NOISE_WORDS = new Set([
    ...STOP_WORDS,
    'article',
    'author',
    'background',
    'build',
    'building',
    'built',
    'choose',
    'choosing',
    'complete',
    'configure',
    'configuring',
    'debug',
    'debugging',
    'digest',
    'doc',
    'docs',
    'documentation',
    'effective',
    'example',
    'examples',
    'existing',
    'guide',
    'include',
    'including',
    'index',
    'lesson',
    'lessons',
    'long',
    'note',
    'notes',
    'official',
    'overview',
    'reference',
    'related',
    'running',
    'saved',
    'source',
    'title',
    'url',
]);
export async function runRegistryInit(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await Promise.all(REGISTRY_DIRECTORIES.map((directory) => mkdir(path.join(paths.root, directory), { recursive: true })));
    await ensureJsonFile(paths.registryFile, { version: 1, wikis: [] });
    await ensureTextFile(paths.queryLog, '');
    await ensureTextFile(paths.intakeEvents, '');
    return {
        registryRoot: paths.root,
        createdDirectories: [...REGISTRY_DIRECTORIES],
        registryFile: paths.registryFile,
    };
}
export async function runRegistryAdd(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const now = new Date().toISOString();
    const id = normalizeWikiId(input.id);
    if (!id) {
        throw new Error('registry-add requires a non-empty --id value using letters, numbers, dot, underscore, or dash.');
    }
    const knowledgeRoot = input.knowledgeRoot
        ? path.resolve(input.knowledgeRoot)
        : path.join(paths.wikisDirectory, id);
    await ensureKnowledgeRootLayout(knowledgeRoot);
    const existing = state.wikis.find((wiki) => wiki.id === id);
    const explicitScopeCore = normalizeStringList(input.scopeCore ?? []);
    const explicitScopeAdjacent = normalizeStringList(input.scopeAdjacent ?? []);
    const scopeCore = explicitScopeCore.length > 0
        ? explicitScopeCore
        : normalizeStringList(input.scope ?? existing?.scopeCore ?? existing?.scope ?? []);
    const scopeAdjacent = explicitScopeAdjacent.length > 0
        ? explicitScopeAdjacent
        : normalizeStringList(existing?.scopeAdjacent ?? []);
    const outOfScope = normalizeStringList(input.outOfScope ?? existing?.outOfScope ?? []);
    const wiki = {
        id,
        title: input.title?.trim() || existing?.title || titleFromId(id),
        knowledgeRoot,
        scopeCore,
        scopeAdjacent,
        scope: [...new Set([...scopeCore, ...scopeAdjacent])],
        outOfScope,
        aliases: normalizeStringList(input.aliases ?? existing?.aliases ?? []),
        conceptAliases: existing?.conceptAliases ?? [],
        granularity: existing?.granularity ?? defaultGranularityPolicy(),
        exampleAccept: existing?.exampleAccept ?? [],
        exampleReject: existing?.exampleReject ?? [],
        profileNotes: normalizeStringList(input.profileNotes ?? existing?.profileNotes ?? []),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    if (existing) {
        Object.assign(existing, wiki);
    }
    else {
        state.wikis.push(wiki);
    }
    state.wikis.sort((left, right) => left.id.localeCompare(right.id));
    const profileFile = path.join(paths.profilesDirectory, `${wiki.id}.json`);
    await writeJsonFile(paths.registryFile, state);
    await writeJsonFile(profileFile, wiki);
    return {
        registryRoot: paths.root,
        wiki,
        registryFile: paths.registryFile,
        profileFile,
    };
}
export async function runRegistryList(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    return {
        registryRoot: paths.root,
        wikis: state.wikis,
    };
}
export async function runRoute(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const source = await summarizeSource(input.source);
    const candidates = rankWikis(source.searchText, state.wikis, focusedRouteText(source));
    const classification = await classifyRouteProposal(paths, source, candidates, state.wikis, await findIntakeItemBySource(paths, input.source));
    const now = new Date().toISOString();
    const proposalId = `route-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`;
    const classificationPackage = await buildClassificationPackage(paths, {
        routeProposalId: proposalId,
        intakeItemId: classification.intakeItemId,
        source,
        candidates,
        wikis: state.wikis,
        recommendedWikiId: classification.recommendedWikiId,
        confidence: classification.confidence,
        bridgeSuggestions: classification.bridgeSuggestions,
        newWikiProposalId: classification.newWikiProposalId,
        decisionType: classification.decisionType,
        createdAt: now,
    });
    const proposal = {
        id: proposalId,
        status: 'proposed',
        decisionType: classification.decisionType,
        source: {
            input: input.source,
            kind: source.kind,
            sha256: source.sha256,
            title: source.title,
            excerpt: source.excerpt,
        },
        candidates,
        recommendedWikiId: classification.recommendedWikiId,
        confidence: classification.confidence,
        evidence: classification.evidence,
        risks: classification.risks,
        humanQuestions: classification.humanQuestions,
        newWikiProposalId: classification.newWikiProposalId,
        parkReason: classification.parkReason,
        rejectReason: classification.rejectReason,
        bridgeSuggestions: classification.bridgeSuggestions,
        classificationPackageId: classificationPackage.id,
        classificationPackage,
        classificationPolicy: classification.classificationPolicy,
        routingAssessment: classification.routingAssessment,
        humanReviewRequired: true,
        intakeItemId: classification.intakeItemId,
        acceptedWikiId: null,
        reviewer: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
    };
    const proposalFile = path.join(paths.routingProposalsDirectory, `${proposal.id}.json`);
    const classificationPackageFile = path.join(paths.classificationPackagesDirectory, `${classificationPackage.id}.json`);
    await writeJsonFile(classificationPackageFile, classificationPackage);
    await writeJsonFile(proposalFile, proposal);
    return {
        registryRoot: paths.root,
        proposal,
        proposalFile,
        classificationPackageFile,
    };
}
export async function runRouteAccept(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const proposalFile = path.join(paths.routingProposalsDirectory, `${input.proposalId}.json`);
    const proposal = await readJsonFile(proposalFile, null);
    if (!proposal) {
        throw new Error(`Route proposal does not exist: ${input.proposalId}`);
    }
    const acceptedWikiId = normalizeWikiId(input.wikiId ?? proposal.recommendedWikiId ?? '');
    if (!acceptedWikiId) {
        throw new Error(`Route proposal ${input.proposalId} has no recommended wiki; pass --wiki <id> to accept explicitly.`);
    }
    const wiki = state.wikis.find((entry) => entry.id === acceptedWikiId);
    if (!wiki) {
        throw new Error(`Unknown wiki id for route acceptance: ${acceptedWikiId}`);
    }
    const reviewer = input.reviewer?.trim() || 'human';
    const ingestResult = await runIngestJob({ knowledgeRoot: wiki.knowledgeRoot, input: proposal.source.input });
    const now = new Date().toISOString();
    const acceptedProposal = {
        ...proposal,
        status: 'accepted',
        acceptedWikiId: wiki.id,
        reviewer,
        reviewedAt: now,
        updatedAt: now,
    };
    const decision = {
        proposalId: proposal.id,
        acceptedWikiId: wiki.id,
        reviewer,
        decidedAt: now,
        ingestResult,
    };
    const decisionFile = path.join(paths.routingDecisionsDirectory, `${proposal.id}.json`);
    await writeJsonFile(proposalFile, acceptedProposal);
    await writeJsonFile(decisionFile, decision);
    await updateIntakeItemAfterRouteAcceptance(paths, acceptedProposal, ingestResult, wiki.id, reviewer);
    const bridgeProposalFiles = await createBridgeProposalsAfterRouteAccept(paths, acceptedProposal, ingestResult, wiki.id);
    return {
        registryRoot: paths.root,
        proposalFile,
        decisionFile,
        bridgeProposalFiles,
        decision,
    };
}
export async function runQueryRegistry(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    if (state.wikis.length === 0) {
        throw new Error(`Cannot query registry: no wikis are registered in ${paths.registryFile}`);
    }
    const rankedWikis = rankWikis(input.question, state.wikis);
    const selected = (rankedWikis.some((wiki) => wiki.score > 0) ? rankedWikis.filter((wiki) => wiki.score > 0) : rankedWikis)
        .slice(0, Math.max(1, input.maxWikis ?? 3));
    const results = [];
    for (const wiki of selected) {
        try {
            const result = await runQuery({ knowledgeRoot: wiki.knowledgeRoot, question: input.question });
            results.push({ ...wiki, result, error: null });
        }
        catch (error) {
            results.push({ ...wiki, result: null, error: error instanceof Error ? error.message : String(error) });
        }
    }
    const answer = buildRegistryAnswer(input.question, results);
    await appendJsonLine(paths.queryLog, {
        question: input.question,
        selectedWikis: selected.map((wiki) => ({ wikiId: wiki.wikiId, score: wiki.score })),
        resultCount: results.filter((entry) => entry.result).length,
        createdAt: new Date().toISOString(),
    });
    return {
        question: input.question,
        answer,
        selectedWikis: selected.map(({ wikiId, title, knowledgeRoot, score, matchedTerms }) => ({ wikiId, title, knowledgeRoot, score, matchedTerms })),
        results,
    };
}
export async function runProfileSuggest(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const item = input.intakeItemId ? await readIntakeItem(paths, input.intakeItemId) : null;
    const sourcePath = input.source ?? (item ? path.join(paths.root, item.currentPath) : null);
    if (!sourcePath) {
        throw new Error('profile-suggest requires --from <intakeItemId> or --source <sourcePathOrUrl>.');
    }
    const source = await summarizeSource(sourcePath);
    const state = await readRegistryState(paths);
    const candidates = rankWikis(source.searchText, state.wikis, focusedRouteText(source));
    const criteria = evaluateNewWikiCriteria(source, candidates);
    const proposedId = normalizeWikiId(input.id ?? suggestWikiId(source.title, source.searchText));
    const now = new Date().toISOString();
    const proposedWiki = buildDraftWikiProfile({
        paths,
        id: proposedId,
        title: input.title?.trim() || titleFromId(proposedId),
        source,
        existingWikis: state.wikis,
        now,
    });
    const proposal = {
        id: `profile-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
        status: 'proposed',
        kind: 'create_wiki',
        targetWikiId: proposedWiki.id,
        proposedWiki,
        rationale: 'No existing wiki should be expanded silently when the source lacks a strong fit. This proposal creates a bounded profile draft for human review.',
        evidence: [
            `Source title: ${source.title}`,
            `Top existing candidate: ${candidates[0]?.wikiId ?? 'none'} (${candidates[0]?.score ?? 0})`,
            `Draft core scope: ${proposedWiki.scopeCore.join(', ') || proposedWiki.title}`,
        ],
        risks: [
            'Creating a wiki from a single source may be too narrow unless future corpus growth is expected.',
            'Accepting an over-broad profile will pollute later routing and retrieval.',
        ],
        reviewQuestions: [
            'Do you expect to collect more sources in this domain?',
            'Is this a governance boundary, or only a topic inside an existing wiki?',
            'Are the proposed out-of-scope rules strong enough to prevent drift?',
        ],
        sourceIntakeItemId: item?.id ?? null,
        sourceRouteProposalId: null,
        newWikiCriteria: criteria,
        reviewer: null,
        reviewedAt: null,
        reason: null,
        createdAt: now,
        updatedAt: now,
    };
    const proposalFile = path.join(paths.profileProposalsDirectory, `${proposal.id}.json`);
    await writeJsonFile(proposalFile, proposal);
    return { registryRoot: paths.root, proposal, proposalFile };
}
export async function runProfileAccept(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const proposalFile = profileProposalFile(paths, input.proposalId);
    const proposal = await readJsonFile(proposalFile, null);
    if (!proposal) {
        throw new Error(`Profile proposal does not exist: ${input.proposalId}`);
    }
    if (!input.reviewer.trim()) {
        throw new Error('profile-accept requires --reviewer <name> after human confirmation.');
    }
    if (proposal.kind !== 'create_wiki' || !proposal.proposedWiki) {
        throw new Error(`Profile proposal ${proposal.id} cannot be accepted as a create-wiki proposal.`);
    }
    const addResult = await runRegistryAdd({
        registryRoot: paths.root,
        id: proposal.proposedWiki.id,
        title: proposal.proposedWiki.title,
        scopeCore: proposal.proposedWiki.scopeCore,
        scopeAdjacent: proposal.proposedWiki.scopeAdjacent,
        outOfScope: proposal.proposedWiki.outOfScope,
        aliases: proposal.proposedWiki.aliases,
        profileNotes: proposal.proposedWiki.profileNotes,
    });
    const accepted = markProfileProposalReviewed(proposal, 'accepted', input.reviewer, input.reason ?? null);
    await writeJsonFile(proposalFile, accepted);
    const decisionFile = path.join(paths.profileDecisionsDirectory, `${proposal.id}.json`);
    await writeJsonFile(decisionFile, {
        proposalId: proposal.id,
        acceptedWikiId: addResult.wiki.id,
        reviewer: input.reviewer.trim(),
        reason: input.reason ?? null,
        decidedAt: accepted.reviewedAt,
    });
    return {
        registryRoot: paths.root,
        proposal: accepted,
        proposalFile,
        registryFile: addResult.registryFile,
        profileFile: addResult.profileFile,
    };
}
export async function runProfileReject(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const proposalFile = profileProposalFile(paths, input.proposalId);
    const proposal = await readJsonFile(proposalFile, null);
    if (!proposal) {
        throw new Error(`Profile proposal does not exist: ${input.proposalId}`);
    }
    if (!input.reviewer.trim()) {
        throw new Error('profile-reject requires --reviewer <name>.');
    }
    if (!input.reason?.trim()) {
        throw new Error('profile-reject requires --reason <reason>.');
    }
    const rejected = markProfileProposalReviewed(proposal, 'rejected', input.reviewer, input.reason);
    await writeJsonFile(proposalFile, rejected);
    return {
        registryRoot: paths.root,
        proposal: rejected,
        proposalFile,
        registryFile: paths.registryFile,
        profileFile: null,
    };
}
export async function runProfileReview(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const decisions = await readRouteDecisions(paths);
    const generatedAt = new Date().toISOString();
    return {
        registryRoot: paths.root,
        generatedAt,
        wikis: state.wikis.map((wiki) => {
            const accepted = decisions.filter((decision) => decision.acceptedWikiId === wiki.id);
            const weakAccepted = accepted.filter((decision) => {
                const proposal = decision.proposal;
                return proposal ? (proposal.candidates.find((candidate) => candidate.wikiId === wiki.id)?.score ?? 0) < 1 : false;
            });
            const suggestedAliases = [...new Set(accepted.flatMap((decision) => tokenize(decision.proposal?.source.title ?? '').slice(0, 4)))]
                .filter((term) => !profilePositiveTerms(wiki).includes(term))
                .slice(0, 8);
            return {
                wikiId: wiki.id,
                title: wiki.title,
                acceptedRoutes: accepted.length,
                weakAcceptedRoutes: weakAccepted.length,
                suggestedAliases,
                driftRisks: [
                    weakAccepted.length > 0 ? `${weakAccepted.length} accepted route(s) had weak profile match; consider tightening scope or adding aliases.` : null,
                    wiki.scopeCore.length === 0 ? 'Profile has no core scope; routing depends too much on title/id.' : null,
                ].filter((value) => Boolean(value)),
            };
        }),
        guidance: [
            'Treat profile changes as proposals: do not silently broaden a wiki because one source barely matched.',
            'Prefer adding aliases for repeated accepted decisions; prefer split/new wiki only when independent terminology, retrieval intent, source standards, scale, and pollution risk support it.',
            'If a wiki accumulates weak accepted routes, review whether it is too broad, too narrow, or missing adjacent scope.',
        ],
    };
}
export async function runIntakeScan(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const entries = await readdir(paths.inboxDirectory, { withFileTypes: true });
    const discoveredItems = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() && !entry.isDirectory()) {
            continue;
        }
        const sourcePath = path.join(paths.inboxDirectory, entry.name);
        const now = new Date().toISOString();
        const id = `src-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`;
        const sha256 = await hashIntakeSource(sourcePath);
        const objectPath = await moveInboxSourceToObjectStore({
            paths,
            sourcePath,
            fileName: entry.name,
            sha256,
        });
        const item = {
            id,
            originalPath: path.relative(paths.root, sourcePath),
            currentPath: path.relative(paths.root, objectPath),
            objectPath: path.relative(paths.root, objectPath),
            fileName: entry.name,
            sourceKind: entry.isDirectory() ? 'directory' : detectRouteSourceKind(entry.name),
            sha256,
            status: 'discovered',
            routeProposalId: null,
            targetWikiId: null,
            taxonomyProposalSlugs: [],
            wikiPages: [],
            managedRawArchive: null,
            reviewRequired: true,
            lastError: null,
            reviewer: null,
            reason: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            rejectedAt: null,
        };
        await writeIntakeItem(paths, item);
        await appendIntakeEvent(paths, { type: 'discovered', itemId: item.id, path: item.currentPath, objectPath: item.objectPath, createdAt: now });
        discoveredItems.push(item);
    }
    const pendingItems = (await readIntakeItems(paths))
        .filter((item) => !isTerminalIntakeStatus(item.status))
        .sort(compareIntakeItems);
    return {
        registryRoot: paths.root,
        inboxPath: paths.inboxDirectory,
        newCount: discoveredItems.length,
        pendingCount: pendingItems.length,
        action: pendingItems.length === 0 ? 'silent' : 'pending',
        discoveredItems,
        pendingItems,
    };
}
export async function runIntakeStatus(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const items = (await readIntakeItems(paths)).sort(compareIntakeItems);
    const countsByStatus = {};
    for (const item of items) {
        countsByStatus[item.status] = (countsByStatus[item.status] ?? 0) + 1;
    }
    return {
        registryRoot: paths.root,
        pendingCount: items.filter((item) => !isTerminalIntakeStatus(item.status)).length,
        items,
        countsByStatus,
    };
}
async function moveInboxSourceToObjectStore(input) {
    const shard = input.sha256.slice(0, 2);
    const objectDirectory = path.join(input.paths.rawObjectsDirectory, shard, input.sha256);
    const objectPath = path.join(objectDirectory, input.fileName);
    await mkdir(objectDirectory, { recursive: true });
    if (await exists(objectPath)) {
        await rm(input.sourcePath, { recursive: true, force: true });
        return objectPath;
    }
    await rename(input.sourcePath, objectPath);
    return objectPath;
}
export async function runIntakeNext(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    const scan = await runIntakeScan({ registryRoot: paths.root });
    const item = scan.pendingItems[0] ?? null;
    if (!item) {
        return {
            registryRoot: paths.root,
            action: 'silent',
            item: null,
            message: 'No new or pending raw sources. A scheduled agent can exit silently.',
            suggestedCommand: null,
        };
    }
    const routeCommand = `llm-wiki route ${shellQuote(paths.root)} ${shellQuote(path.join(paths.root, item.currentPath))}`;
    const acceptCommand = item.routeProposalId
        ? `llm-wiki route-accept ${shellQuote(paths.root)} ${shellQuote(item.routeProposalId)} --wiki <wiki-id> --reviewer <name>`
        : null;
    if (item.status === 'discovered' || item.status === 'blocked') {
        return {
            registryRoot: paths.root,
            action: 'route-source',
            item,
            message: 'Show the source summary and route proposal to the human before ingesting.',
            suggestedCommand: routeCommand,
        };
    }
    if (item.status === 'route_proposed') {
        const proposal = item.routeProposalId
            ? await readJsonFile(path.join(paths.routingProposalsDirectory, `${item.routeProposalId}.json`), null)
            : null;
        if (proposal?.decisionType === 'create_new_wiki' && proposal.newWikiProposalId) {
            return {
                registryRoot: paths.root,
                action: 'profile-review',
                item,
                message: 'The source did not strongly match existing profiles. Show the proposed new wiki profile and ask the human whether to create it, park, reject, or override into an existing wiki.',
                suggestedCommand: `llm-wiki profile-accept ${shellQuote(paths.root)} ${shellQuote(proposal.newWikiProposalId)} --reviewer <name>`,
            };
        }
        return {
            registryRoot: paths.root,
            action: 'show-route-proposal',
            item,
            message: 'Display the proposed target wiki, candidates, and rationale; wait for explicit human acceptance.',
            suggestedCommand: acceptCommand,
        };
    }
    if (item.status === 'route_accepted' || item.status === 'ingested' || item.status === 'taxonomy_review' || item.status === 'taxonomy_resolved' || item.status === 'indexed') {
        return {
            registryRoot: paths.root,
            action: 'continue-review',
            item,
            message: 'Continue pending review/index checks, then complete or reject the intake item with an explicit reviewer.',
            suggestedCommand: `llm-wiki intake-complete ${shellQuote(paths.root)} ${shellQuote(item.id)} --reviewer <name>`,
        };
    }
    return {
        registryRoot: paths.root,
        action: 'complete-or-reject',
        item,
        message: 'Resolve this intake item by completing or rejecting it explicitly.',
        suggestedCommand: `llm-wiki intake-complete ${shellQuote(paths.root)} ${shellQuote(item.id)} --reviewer <name>`,
    };
}
export async function runIntakeComplete(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const reviewer = input.reviewer?.trim() || 'human';
    const item = await updateIntakeItem(paths, input.itemId, (current) => ({
        ...current,
        status: 'completed',
        reviewer,
        reason: null,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }), 'completed');
    return {
        registryRoot: paths.root,
        item,
        itemFile: intakeItemFile(paths, item.id),
    };
}
export async function runIntakeReject(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const reviewer = input.reviewer.trim();
    const reason = input.reason.trim();
    if (!reviewer) {
        throw new Error('intake-reject requires --reviewer <name> after human review.');
    }
    if (!reason) {
        throw new Error('intake-reject requires --reason <reason>.');
    }
    const item = await updateIntakeItem(paths, input.itemId, (current) => ({
        ...current,
        status: 'rejected',
        reviewer,
        reason,
        rejectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    }), 'rejected');
    return {
        registryRoot: paths.root,
        item,
        itemFile: intakeItemFile(paths, item.id),
    };
}
export async function runIntakePark(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const reviewer = input.reviewer.trim();
    const reason = input.reason.trim();
    if (!reviewer) {
        throw new Error('intake-park requires --reviewer <name>.');
    }
    if (!reason) {
        throw new Error('intake-park requires --reason <reason>.');
    }
    const item = await updateIntakeItem(paths, input.itemId, (current) => ({
        ...current,
        status: 'parked',
        reviewer,
        reason,
        reviewRequired: false,
        updatedAt: new Date().toISOString(),
    }), 'parked');
    return {
        registryRoot: paths.root,
        item,
        itemFile: intakeItemFile(paths, item.id),
    };
}
export async function runRouteInbox(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const scan = await runIntakeScan({ registryRoot: paths.root });
    const items = scan.pendingItems
        .filter((item) => item.status === 'discovered' || item.status === 'blocked')
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const results = [];
    for (const item of items) {
        try {
            const source = path.join(paths.root, item.currentPath);
            const routeResult = await runRoute({ registryRoot: paths.root, source });
            results.push(routeResult);
            await updateIntakeItem(paths, item.id, (current) => ({
                ...current,
                status: 'route_proposed',
                routeProposalId: routeResult.proposal.id,
                lastError: null,
                updatedAt: new Date().toISOString(),
            }), 'route-proposed');
        }
        catch (error) {
            await updateIntakeItem(paths, item.id, (current) => ({
                ...current,
                status: 'blocked',
                lastError: error instanceof Error ? error.message : String(error),
                updatedAt: new Date().toISOString(),
            }), 'route-blocked');
        }
    }
    return {
        registryRoot: paths.root,
        inboxPath: paths.inboxDirectory,
        scan,
        results,
    };
}
export async function runBridgeIndex(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const links = [];
    for (const wiki of state.wikis) {
        let indexedPages = [];
        try {
            indexedPages = await loadIndexedPages(wiki.knowledgeRoot);
        }
        catch {
            continue;
        }
        const targetsByWiki = new Map(state.wikis.map((entry) => [entry.id, entry]));
        for (const page of indexedPages) {
            let content = '';
            try {
                content = await readFile(page.filePath, 'utf8');
            }
            catch {
                continue;
            }
            for (const match of content.matchAll(/llm-wiki:\/\/([^/\s)\]]+)\/([^\s)\]]+)/g)) {
                const toWikiId = normalizeWikiId(match[1] ?? '');
                const toTarget = (match[2] ?? '').replace(/[.,;:]+$/g, '').replace(/\.md$/i, '');
                const targetWiki = targetsByWiki.get(toWikiId);
                let status = 'resolved';
                if (!targetWiki) {
                    status = 'unknown-wiki';
                }
                else {
                    const targetFile = path.join(targetWiki.knowledgeRoot, 'wiki', `${toTarget}.md`);
                    if (!(await exists(targetFile))) {
                        status = 'missing-page';
                    }
                }
                links.push({
                    fromWikiId: wiki.id,
                    fromTarget: page.target,
                    fromFilePath: page.filePath,
                    toWikiId,
                    toTarget,
                    raw: match[0],
                    status,
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
export async function runBridgeAccept(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const proposal = await readBridgeProposal(paths, input.proposalId);
    if (!proposal) {
        throw new Error(`Bridge proposal does not exist: ${input.proposalId}`);
    }
    if (!input.reviewer.trim()) {
        throw new Error('bridge-accept requires --reviewer <name> after human confirmation.');
    }
    const now = new Date().toISOString();
    const accepted = {
        ...proposal,
        status: 'accepted',
        reviewer: input.reviewer.trim(),
        reviewedAt: now,
        reason: input.reason ?? null,
        updatedAt: now,
    };
    const files = [bridgeProposalFile(paths, accepted.id)];
    if (accepted.sourcePageFile) {
        await appendBridgeLinkToSourcePage(accepted.sourcePageFile, accepted.suggestedLink, accepted.rationale);
        files.push(accepted.sourcePageFile);
    }
    await writeJsonFile(bridgeProposalFile(paths, accepted.id), accepted);
    await writeJsonFile(path.join(paths.bridgeDecisionsDirectory, `${accepted.id}.json`), {
        proposalId: accepted.id,
        status: 'accepted',
        reviewer: accepted.reviewer,
        reason: accepted.reason,
        decidedAt: now,
        suggestedLink: accepted.suggestedLink,
    });
    files.push(path.join(paths.bridgeDecisionsDirectory, `${accepted.id}.json`));
    return {
        registryRoot: paths.root,
        proposal: accepted,
        proposalFile: bridgeProposalFile(paths, accepted.id),
        files,
    };
}
export async function runBridgeReject(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const proposal = await readBridgeProposal(paths, input.proposalId);
    if (!proposal) {
        throw new Error(`Bridge proposal does not exist: ${input.proposalId}`);
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
function resolveRegistryPaths(registryRoot) {
    const root = path.resolve(registryRoot);
    return {
        root,
        registryDirectory: path.join(root, 'registry'),
        registryFile: path.join(root, 'registry', 'wikis.json'),
        profilesDirectory: path.join(root, 'registry', 'profiles'),
        profileProposalsDirectory: path.join(root, 'registry', 'profiles', 'proposals'),
        profileDecisionsDirectory: path.join(root, 'registry', 'profiles', 'decisions'),
        classificationPackagesDirectory: path.join(root, 'registry', 'classification', 'packages'),
        routingProposalsDirectory: path.join(root, 'registry', 'routing', 'proposals'),
        routingDecisionsDirectory: path.join(root, 'registry', 'routing', 'decisions'),
        bridgesDirectory: path.join(root, 'registry', 'bridges'),
        bridgeProposalsDirectory: path.join(root, 'registry', 'bridges', 'proposals'),
        bridgeDecisionsDirectory: path.join(root, 'registry', 'bridges', 'decisions'),
        wikisDirectory: path.join(root, 'wikis'),
        inboxDirectory: path.join(root, 'raw', 'inbox'),
        rawObjectsDirectory: path.join(root, 'raw', 'objects'),
        intakeItemsDirectory: path.join(root, 'system', 'intake', 'items'),
        intakeSpoolDirectory: path.join(root, 'system', 'intake', 'spool'),
        intakeEvents: path.join(root, 'system', 'intake', 'events.jsonl'),
        intakeLocksDirectory: path.join(root, 'system', 'intake', 'locks'),
        atlasIndexDirectory: path.join(root, 'system', 'index'),
        ragDirectory: path.join(root, 'system', 'rag'),
        queryLog: path.join(root, 'registry', 'query-log.jsonl'),
    };
}
async function readRegistryState(paths) {
    const state = await readJsonFile(paths.registryFile, { version: 1, wikis: [] });
    return {
        version: 1,
        wikis: state.wikis.map(normalizeWikiProfile),
    };
}
async function classifyRouteProposal(paths, source, candidates, wikis, intakeItem) {
    const top = candidates[0];
    const second = candidates[1];
    const criteria = evaluateNewWikiCriteria(source, candidates);
    const strongMatch = Boolean(top && isStrongRouteCandidate(top));
    const weakMatch = Boolean(top && top.score > 0 && !isStrongRouteCandidate(top));
    const bridgeSuggestions = buildBridgeSuggestions(candidates);
    if (source.kind === 'unknown') {
        return {
            decisionType: 'reject_source',
            recommendedWikiId: null,
            confidence: 'medium',
            evidence: [`Unsupported or unreadable source: ${source.title}`],
            risks: ['Ingesting unsupported input would create low-quality or unverifiable pages.'],
            humanQuestions: ['Should this source be converted to Markdown before routing?'],
            newWikiProposalId: null,
            parkReason: null,
            rejectReason: 'Unsupported or unreadable source; convert first or reject.',
            bridgeSuggestions: [],
            classificationPolicy: buildClassificationPolicy(criteria),
            routingAssessment: {
                ownershipDecision: 'reject',
                relationshipHint: 'unsupported_source',
                nearestWikiId: null,
                novelty: 'high',
                rationale: 'The source cannot be routed until it is converted or made readable.',
                reviewFocus: ['Convert the source to Markdown or reject it before semantic classification.'],
            },
            intakeItemId: intakeItem?.id ?? null,
        };
    }
    if (source.sourceRole === 'source-map') {
        return {
            decisionType: 'park_for_later',
            recommendedWikiId: top?.wikiId ?? null,
            confidence: 'low',
            evidence: [
                `Source appears to be an index/source-map: ${source.title}.`,
                top ? `Nearest existing wiki is ${top.wikiId} with score ${top.score}.` : 'No existing wiki candidate was available.',
            ],
            risks: [
                'Index/source-map files can duplicate or amplify linked documents instead of adding new primary evidence.',
                'Review whether this should be used as navigation context, split into referenced sources, or rejected.',
            ],
            humanQuestions: [
                'Should this source be parked as navigation context instead of ingested as ordinary knowledge?',
                top ? `If accepted anyway, should ${top.wikiId} own it?` : 'Which wiki, if any, should own this source map?',
            ],
            newWikiProposalId: null,
            parkReason: 'Index/source-map source should not silently become canonical wiki knowledge.',
            rejectReason: null,
            bridgeSuggestions: [],
            classificationPolicy: buildClassificationPolicy(criteria),
            routingAssessment: {
                ownershipDecision: 'park',
                relationshipHint: 'source_map',
                nearestWikiId: top?.wikiId ?? null,
                novelty: 'low',
                rationale: 'The source looks like navigation or an index rather than primary knowledge evidence.',
                reviewFocus: ['Decide whether to use this as navigation context, split referenced sources, or reject it.'],
            },
            intakeItemId: intakeItem?.id ?? null,
        };
    }
    if (strongMatch) {
        return {
            decisionType: bridgeSuggestions.length > 0 ? 'bridge_existing_wikis' : 'route_existing',
            recommendedWikiId: top.wikiId,
            confidence: top.score >= ROUTE_HIGH_CONFIDENCE_SCORE ? 'high' : 'medium',
            evidence: [
                `Best existing wiki: ${top.wikiId} with score ${top.score}.`,
                `Matched terms: ${top.matchedTerms.join(', ') || 'none'}.`,
            ],
            risks: bridgeSuggestions.length > 0
                ? ['Source appears cross-domain; avoid duplicating canonical pages across wikis.']
                : [],
            humanQuestions: [
                `Confirm ingest into ${top.wikiId}, or override with another wiki id.`,
                'If the source is cross-domain, should a bridge be created instead of duplicating content?',
            ],
            newWikiProposalId: null,
            parkReason: null,
            rejectReason: null,
            bridgeSuggestions,
            classificationPolicy: buildClassificationPolicy(criteria),
            routingAssessment: buildRoutingAssessment('strong_existing', top, criteria),
            intakeItemId: intakeItem?.id ?? null,
        };
    }
    if (weakMatch && criteria.satisfied.length < criteria.requiredThreshold) {
        return {
            decisionType: 'park_for_later',
            recommendedWikiId: top.wikiId,
            confidence: 'low',
            evidence: [
                `Only weak existing wiki match: ${top.wikiId} with score ${top.score}.`,
                `New-wiki criteria satisfied: ${criteria.satisfied.length}/${criteria.requiredThreshold}.`,
            ],
            risks: ['Forcing a weak match may pollute the target wiki; creating a wiki from one source may be too narrow.'],
            humanQuestions: [
                `Is this merely adjacent to ${top.wikiId}, or should it wait until more related sources exist?`,
            ],
            newWikiProposalId: null,
            parkReason: 'Weak existing match and insufficient evidence for a durable new wiki boundary.',
            rejectReason: null,
            bridgeSuggestions,
            classificationPolicy: buildClassificationPolicy(criteria),
            routingAssessment: buildRoutingAssessment('park', top, criteria),
            intakeItemId: intakeItem?.id ?? null,
        };
    }
    const profileSuggestion = await createProfileProposalForSource(paths, {
        source,
        sourcePath: intakeItem ? path.join(paths.root, intakeItem.currentPath) : source.title,
        intakeItemId: intakeItem?.id ?? null,
        routeProposalId: null,
        existingWikis: wikis,
        candidates,
    });
    return {
        decisionType: 'create_new_wiki',
        recommendedWikiId: null,
        confidence: 'low',
        evidence: [
            `No strong existing wiki match; top score is ${top?.score ?? 0}.`,
            `New-wiki criteria satisfied: ${criteria.satisfied.join('; ') || 'none'}.`,
        ],
        risks: [
            'Human must confirm expected future corpus and profile boundaries before creating the wiki.',
            second ? `Nearest alternatives were ${top?.wikiId ?? 'none'} and ${second.wikiId}; avoid unnecessary split if they share retrieval intent.` : 'No comparable existing wiki was available.',
        ],
        humanQuestions: profileSuggestion.proposal.reviewQuestions,
        newWikiProposalId: profileSuggestion.proposal.id,
        parkReason: null,
        rejectReason: null,
        bridgeSuggestions,
        classificationPolicy: buildClassificationPolicy(criteria),
        routingAssessment: buildRoutingAssessment('new_profile', top ?? null, criteria),
        intakeItemId: intakeItem?.id ?? null,
    };
}
async function createProfileProposalForSource(paths, input) {
    const now = new Date().toISOString();
    const criteria = evaluateNewWikiCriteria(input.source, input.candidates);
    const id = normalizeWikiId(suggestWikiId(input.source.title, input.source.searchText));
    const proposedWiki = buildDraftWikiProfile({
        paths,
        id,
        title: titleFromId(id),
        source: input.source,
        existingWikis: input.existingWikis,
        now,
    });
    const proposal = {
        id: `profile-${now.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
        status: 'proposed',
        kind: 'create_wiki',
        targetWikiId: proposedWiki.id,
        proposedWiki,
        rationale: 'The source did not strongly match existing wiki profiles. Create a new wiki only if this is a durable governance boundary, not a one-off topic.',
        evidence: [
            `Source title: ${input.source.title}`,
            `Top candidate score: ${input.candidates[0]?.score ?? 0}`,
            `Proposed core scope: ${proposedWiki.scopeCore.join(', ')}`,
        ],
        risks: [
            'Too broad a profile will capture unrelated future sources.',
            'Too narrow a profile will fragment the atlas and increase bridge/query overhead.',
        ],
        reviewQuestions: [
            'Do you expect repeated future sources in this domain?',
            'Is this better represented as a topic inside an existing wiki?',
            'Which terms should be explicitly out-of-scope to prevent drift?',
        ],
        sourceIntakeItemId: input.intakeItemId,
        sourceRouteProposalId: input.routeProposalId,
        newWikiCriteria: criteria,
        reviewer: null,
        reviewedAt: null,
        reason: null,
        createdAt: now,
        updatedAt: now,
    };
    const proposalFile = path.join(paths.profileProposalsDirectory, `${proposal.id}.json`);
    await writeJsonFile(proposalFile, proposal);
    return { registryRoot: paths.root, proposal, proposalFile };
}
function evaluateNewWikiCriteria(source, candidates) {
    const topScore = candidates[0]?.score ?? 0;
    const hasStrongFit = candidates[0] ? isStrongRouteCandidate(candidates[0]) : false;
    const tokens = [...new Set(tokenize(source.searchText))];
    const satisfied = [
        !hasStrongFit ? 'No existing wiki has a strong semantic/profile fit.' : null,
        tokens.length >= 8 ? 'Source exposes enough distinct terminology to draft a boundary.' : null,
        source.excerpt.length >= 160 ? 'Source has enough content to evaluate retrieval intent and scope.' : null,
        !hasStrongFit && topScore < ROUTE_STRONG_MATCH_SCORE ? 'Forcing this into an existing wiki would create taxonomy pollution risk.' : null,
        source.kind !== 'unknown' ? 'Source format is ingestible after human route/profile confirmation.' : null,
    ].filter((value) => Boolean(value));
    const all = [
        'No existing wiki has a strong semantic/profile fit.',
        'Source exposes enough distinct terminology to draft a boundary.',
        'Source has enough content to evaluate retrieval intent and scope.',
        'Forcing this into an existing wiki would create taxonomy pollution risk.',
        'Source format is ingestible after human route/profile confirmation.',
    ];
    return {
        satisfied,
        missing: all.filter((criterion) => !satisfied.includes(criterion)),
        requiredThreshold: 3,
    };
}
function buildClassificationPolicy(criteria) {
    return {
        summary: 'Route into an existing wiki only on a strong fit; create a new wiki only when at least three boundary criteria are satisfied; otherwise park/reject instead of forcing a category.',
        newWikiRequiredSatisfied: criteria.satisfied,
        newWikiRequiredMissing: criteria.missing,
        requiredSatisfiedCount: criteria.satisfied.length,
        requiredThreshold: criteria.requiredThreshold,
    };
}
function buildRoutingAssessment(ownershipDecision, top, criteria) {
    const relationshipHint = top?.relationshipHint ?? 'unrelated';
    const novelty = ownershipDecision === 'strong_existing'
        ? 'low'
        : relationshipHint === 'possible_child_profile'
            ? 'medium'
            : relationshipHint === 'same_scheme' || relationshipHint === 'adjacent_family'
                ? 'low'
                : 'high';
    const reviewFocus = [
        top ? `Nearest wiki candidate: ${top.wikiId} (${top.matchQuality}, ${top.relationshipHint}, score ${top.score}).` : 'No existing wiki candidate is available.',
        top && top.focusedMatches.length > 0
            ? `Focused title/abstract matches: ${top.focusedMatches.join(', ')}.`
            : 'No focused title/abstract profile evidence; inspect whether full-document matches are only citations, tables, or background discussion.',
        criteria.satisfied.length > 0
            ? `New-profile criteria satisfied: ${criteria.satisfied.length}/${criteria.requiredThreshold}.`
            : 'No new-profile criteria were satisfied.',
    ];
    const rationale = top
        ? routingAssessmentRationale(ownershipDecision, top)
        : 'No registered wiki is available, so the source requires a profile proposal or parking.';
    return {
        ownershipDecision,
        relationshipHint,
        nearestWikiId: top?.wikiId ?? null,
        novelty,
        rationale,
        reviewFocus,
    };
}
function routingAssessmentRationale(ownershipDecision, top) {
    if (ownershipDecision === 'strong_existing') {
        return `Route can be proposed to ${top.wikiId} because profile-level evidence matched strongly.`;
    }
    if (ownershipDecision === 'park') {
        return `The nearest wiki is ${top.wikiId}, but the evidence is too weak to force ownership and too thin to draft a durable profile automatically.`;
    }
    if (top.relationshipHint === 'possible_child_profile') {
        return `The source appears related to ${top.wikiId}, but focused evidence suggests a potentially distinct child or sibling profile rather than direct ownership.`;
    }
    if (top.relationshipHint === 'adjacent_family') {
        return `The source is adjacent to ${top.wikiId}, but existing profile evidence is not strong enough for direct ownership.`;
    }
    if (top.relationshipHint === 'generic_overlap') {
        return `The nearest signal for ${top.wikiId} comes mostly from broad or full-document token overlap; use this only as a review hint.`;
    }
    return 'The source does not appear owned by an existing wiki profile.';
}
async function buildClassificationPackage(paths, input) {
    const topics = buildPackageTopics(input.source);
    const tags = [...new Set(topics.map((topic) => topic.slug))];
    const relatedPages = await collectRelatedPages(input.source, input.wikis);
    const primaryWiki = input.recommendedWikiId
        ? {
            wikiId: input.recommendedWikiId,
            confidence: input.confidence,
            rationale: `Primary ownership candidate from route decision type ${input.decisionType}.`,
        }
        : null;
    const topScore = input.candidates[0]?.score ?? 0;
    const secondaryWikis = input.candidates
        .filter((candidate) => candidate.wikiId !== input.recommendedWikiId && candidate.score > 0)
        .slice(0, 4)
        .map((candidate) => ({
        wikiId: candidate.wikiId,
        relation: (isStrongRouteCandidate(candidate) && topScore - candidate.score <= 1 ? 'co-relevant' : isStrongRouteCandidate(candidate) ? 'bridge' : 'possible-secondary'),
        confidence: scoreToConfidence(candidate.score),
        rationale: isStrongRouteCandidate(candidate)
            ? `Also matched strongly (${candidate.score}); treat as secondary/bridge context, not silent duplicate ownership.`
            : `Weak secondary signal (${candidate.score}); show only as context unless human confirms.`,
    }));
    return {
        id: `class-${input.createdAt.slice(0, 10).replace(/-/g, '')}-${randomUUID()}`,
        routeProposalId: input.routeProposalId,
        intakeItemId: input.intakeItemId,
        humanReviewRequired: true,
        sourceTitle: input.source.title,
        primaryWiki,
        secondaryWikis,
        topics,
        tags,
        relatedPages,
        linkSuggestions: buildLinkSuggestions(primaryWiki?.wikiId ?? null, relatedPages, input.bridgeSuggestions),
        proposedOperations: buildClassificationOperations(paths, input.routeProposalId, input.intakeItemId, input.newWikiProposalId, input.decisionType, input.recommendedWikiId),
        reviewQuestions: [
            'Is the primary wiki the correct owner, or should this be parked/rejected?',
            'Are the secondary wiki relationships bridge context or true co-relevant domains?',
            'Which proposed topics/tags should become canonical taxonomy proposals after ingest?',
            'Which related-page/link suggestions are real enough to keep?',
        ],
        createdAt: input.createdAt,
    };
}
function buildPackageTopics(source) {
    const terms = extractClassificationTopicTerms(source, 8);
    const [root, ...children] = terms;
    if (!root) {
        return [];
    }
    const rootTopic = {
        slug: root,
        title: titleFromId(root),
        level: 1,
        parentSlug: null,
        confidence: 0.72,
        rationale: 'Top source term; candidate broad topic for human review.',
    };
    return [
        rootTopic,
        ...children.map((term, index) => ({
            slug: term,
            title: titleFromId(term),
            level: index < 3 ? 2 : 3,
            parentSlug: root,
            confidence: Number(Math.max(0.48, 0.68 - index * 0.03).toFixed(2)),
            rationale: 'Derived from source title/content terms; candidate internal taxonomy, not canonical until accepted.',
        })),
    ];
}
function extractClassificationTopicTerms(source, limit) {
    return [
        ...extractTitleTopicCandidates(source.title),
        ...extractProfileTerms(source.searchText, source.title, limit * 2).filter(isUsefulClassificationTopicToken),
    ]
        .filter((term) => term.length > 0)
        .filter((term, index, terms) => terms.indexOf(term) === index)
        .slice(0, limit);
}
function extractTitleTopicCandidates(title) {
    const candidates = new Set();
    const normalizedTitle = normalizeClassificationTitle(title);
    for (const segment of splitClassificationTitleSegments(normalizedTitle)) {
        addTitleTopicCandidate(candidates, segment);
        for (const subSegment of segment.split(/\b(?:for|using|with|to|and|of)\b/gi)) {
            addTitleTopicCandidate(candidates, subSegment);
        }
        const forMatch = segment.match(/^(.+?)\s+for\s+(.+)$/i);
        if (forMatch) {
            addTitleTopicCandidate(candidates, forMatch[1] ?? '');
            addTitleTopicCandidate(candidates, forMatch[2] ?? '');
        }
    }
    return [...candidates];
}
function normalizeClassificationTitle(title) {
    return title
        .replace(/^#+\s*/, '')
        .replace(/\bcomplete official documentation\b/gi, '')
        .replace(/\bofficial documentation\b/gi, '')
        .replace(/\bsaved[_\s-]*date\b.*$/gi, '')
        .replace(/\bsource[_\s-]*url\b.*$/gi, '')
        .replace(/[“”"']/g, '')
        .replace(/[_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function splitClassificationTitleSegments(title) {
    return title
        .split(/\s+(?:[-–—:])\s+|[:：]/g)
        .map((segment) => segment.replace(/\([^)]*\)/g, (match) => ` ${match.slice(1, -1)} `))
        .flatMap((segment) => segment.split(/\s{2,}/g))
        .map((segment) => segment.trim())
        .filter(Boolean);
}
function addTitleTopicCandidate(candidates, rawPhrase) {
    const slug = slugifyClassificationTopic(rawPhrase);
    if (isUsefulClassificationTopic(slug)) {
        candidates.add(slug);
    }
}
function slugifyClassificationTopic(value) {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}-]+/gu, ' ')
        .split(/\s+/g)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => !CLASSIFICATION_TOPIC_NOISE_WORDS.has(token))
        .join('-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function isUsefulClassificationTopic(slug) {
    const tokens = slug.split('-').filter(Boolean);
    if (tokens.length === 0 || tokens.length > 5) {
        return false;
    }
    if (tokens.length === 1) {
        return isUsefulClassificationTopicToken(tokens[0]);
    }
    return tokens.some(isUsefulClassificationTopicToken);
}
function isUsefulClassificationTopicToken(token) {
    if (CLASSIFICATION_TOPIC_NOISE_WORDS.has(token)) {
        return false;
    }
    if (/^\d+$/.test(token)) {
        return false;
    }
    if (/^[\p{L}\p{N}]+$/u.test(token) && token.length < 3) {
        return false;
    }
    return true;
}
async function collectRelatedPages(source, wikis) {
    const sourceTokens = new Set(tokenize(source.searchText));
    const related = [];
    for (const wiki of wikis) {
        let pages = [];
        try {
            pages = await loadIndexedPages(wiki.knowledgeRoot);
        }
        catch {
            continue;
        }
        for (const page of pages) {
            const pageTokens = tokenize(`${page.title} ${page.target}`);
            const overlap = pageTokens.filter((token) => sourceTokens.has(token));
            if (overlap.length === 0) {
                continue;
            }
            related.push({
                wikiId: wiki.id,
                target: page.target,
                title: page.title,
                relationship: overlap.length >= 3 ? 'same-topic' : 'supporting-context',
                confidence: Number(Math.min(0.9, 0.45 + overlap.length * 0.12).toFixed(2)),
                rationale: `Matched related page terms: ${[...new Set(overlap)].slice(0, 6).join(', ')}.`,
            });
        }
    }
    return related
        .sort((left, right) => right.confidence - left.confidence || left.wikiId.localeCompare(right.wikiId) || left.target.localeCompare(right.target))
        .slice(0, 8);
}
function buildLinkSuggestions(primaryWikiId, relatedPages, bridgeSuggestions) {
    const relatedLinks = relatedPages.slice(0, 6).map((page) => ({
        wikiId: page.wikiId,
        link: primaryWikiId && page.wikiId !== primaryWikiId
            ? `llm-wiki://${page.wikiId}/${page.target}`
            : `[[${page.target}|${page.title}]]`,
        target: page.target,
        rationale: page.rationale,
    }));
    const bridgeLinks = bridgeSuggestions.map((bridge) => ({
        wikiId: bridge.toWikiId,
        link: `llm-wiki://${bridge.toWikiId}/<section>/<slug>`,
        target: '<section>/<slug>',
        rationale: bridge.rationale,
    }));
    return [...relatedLinks, ...bridgeLinks];
}
function buildClassificationOperations(paths, routeProposalId, intakeItemId, newWikiProposalId, decisionType, recommendedWikiId) {
    const operations = [];
    if (recommendedWikiId) {
        operations.push({
            action: 'accept-primary-route',
            command: `llm-wiki route-accept ${shellQuote(paths.root)} ${shellQuote(routeProposalId)} --wiki ${shellQuote(recommendedWikiId)} --reviewer <name>`,
            requiresHumanApproval: true,
            rationale: 'Accept the primary wiki route and ingest only after the human confirms the proposal shown by the agent.',
        });
    }
    if (newWikiProposalId) {
        operations.push({
            action: 'accept-new-profile',
            command: `llm-wiki profile-accept ${shellQuote(paths.root)} ${shellQuote(newWikiProposalId)} --reviewer <name>`,
            requiresHumanApproval: true,
            rationale: 'Create the proposed wiki/profile only if the boundary is durable enough.',
        });
    }
    if (decisionType === 'bridge_existing_wikis') {
        operations.push({
            action: 'review-bridge',
            command: 'llm-wiki bridge-list <registryRoot>',
            requiresHumanApproval: true,
            rationale: 'After route acceptance, bridge proposals should be reviewed before cross-wiki links are written.',
        });
    }
    operations.push({
        action: 'review-taxonomy',
        command: 'llm-wiki taxonomy-list <acceptedKnowledgeRoot>',
        requiresHumanApproval: true,
        rationale: 'Topics/tags in this package are candidate internal taxonomy; canonicalization needs taxonomy review.',
    });
    if (intakeItemId) {
        operations.push({
            action: 'park',
            command: `llm-wiki intake-park ${shellQuote(paths.root)} ${shellQuote(intakeItemId)} --reviewer <name> --reason <reason>`,
            requiresHumanApproval: true,
            rationale: 'Use when the source is plausible but not ready for durable routing/profile creation.',
        }, {
            action: 'reject',
            command: `llm-wiki intake-reject ${shellQuote(paths.root)} ${shellQuote(intakeItemId)} --reviewer <name> --reason <reason>`,
            requiresHumanApproval: true,
            rationale: 'Use when the source should not enter this atlas or should be converted first.',
        });
    }
    return operations;
}
function scoreToConfidence(score) {
    if (score >= ROUTE_HIGH_CONFIDENCE_SCORE)
        return 'high';
    if (score >= ROUTE_STRONG_MATCH_SCORE)
        return 'medium';
    return 'low';
}
function buildDraftWikiProfile(input) {
    const core = extractProfileTerms(input.source.searchText, input.source.title, 8);
    const adjacent = input.existingWikis
        .flatMap((wiki) => profilePositiveTerms(wiki).filter((term) => input.source.searchText.toLowerCase().includes(term)))
        .slice(0, 6);
    return {
        id: input.id,
        title: input.title,
        knowledgeRoot: path.join(input.paths.wikisDirectory, input.id),
        scopeCore: core,
        scopeAdjacent: [...new Set(adjacent)],
        scope: [...new Set([...core, ...adjacent])],
        outOfScope: [
            'single-source parking without expected future corpus',
            'materials whose primary retrieval intent belongs to another registered wiki',
        ],
        aliases: [input.source.title].filter(Boolean),
        conceptAliases: core.slice(0, 4).map((term) => ({ canonical: term, aliases: [] })),
        granularity: defaultGranularityPolicy(),
        exampleAccept: [input.source.title],
        exampleReject: [],
        profileNotes: [
            'Drafted from one source; human should tighten scope before accepting.',
            'Wiki boundaries are governance/retrieval boundaries, not ordinary folder categories.',
        ],
        createdAt: input.now,
        updatedAt: input.now,
    };
}
function normalizeWikiProfile(wiki) {
    const scopeCore = normalizeStringList(wiki.scopeCore ?? wiki.scope ?? []);
    const scopeAdjacent = normalizeStringList(wiki.scopeAdjacent ?? []);
    return {
        ...wiki,
        scopeCore,
        scopeAdjacent,
        scope: [...new Set([...scopeCore, ...scopeAdjacent, ...(wiki.scope ?? [])])],
        outOfScope: normalizeStringList(wiki.outOfScope ?? []),
        aliases: normalizeStringList(wiki.aliases ?? []),
        conceptAliases: wiki.conceptAliases ?? [],
        granularity: wiki.granularity ?? defaultGranularityPolicy(),
        exampleAccept: wiki.exampleAccept ?? [],
        exampleReject: wiki.exampleReject ?? [],
        profileNotes: wiki.profileNotes ?? [],
    };
}
function defaultGranularityPolicy() {
    return {
        preferredLevel: 'field',
        splitWhen: [
            'independent terminology',
            'different retrieval intent',
            'different source quality/review standards',
            'expected recurring corpus',
            'high pollution risk if forced into an existing wiki',
        ],
        doNotSplitWhen: [
            'only a technique variant',
            'mostly queried together with an existing wiki',
            'shares the same sources and concepts',
            'single source with no expected follow-up corpus',
        ],
    };
}
async function updateIntakeItemAfterRouteAcceptance(paths, proposal, ingestResult, wikiId, reviewer) {
    const item = proposal.intakeItemId
        ? await readIntakeItem(paths, proposal.intakeItemId)
        : await findIntakeItemByRouteProposal(paths, proposal.id);
    if (!item) {
        return;
    }
    const terminalFailure = ingestResult.status === 'failed_terminal' || ingestResult.status === 'failed_retryable' || ingestResult.status === 'rejected';
    const taxonomyProposalSlugs = ingestResult.taxonomyFiles.map(taxonomySlugFromFile).filter((slug) => Boolean(slug));
    const status = terminalFailure
        ? 'blocked'
        : ingestResult.status === 'needs_review' || ingestResult.status === 'partial' || taxonomyProposalSlugs.length > 0
            ? 'taxonomy_review'
            : 'ingested';
    await updateIntakeItem(paths, item.id, (current) => ({
        ...current,
        status,
        targetWikiId: wikiId,
        routeProposalId: proposal.id,
        taxonomyProposalSlugs,
        wikiPages: ingestResult.writtenFiles,
        managedRawArchive: ingestResult.archivePath ?? ingestResult.retainedPath ?? ingestResult.rejectedPath,
        reviewRequired: status === 'taxonomy_review',
        lastError: terminalFailure ? `ingest status: ${ingestResult.status}` : null,
        reviewer,
        updatedAt: new Date().toISOString(),
    }), 'route-accepted');
}
async function createBridgeProposalsAfterRouteAccept(paths, proposal, ingestResult, primaryWikiId) {
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
async function readBridgeProposal(paths, proposalId) {
    return readJsonFile(bridgeProposalFile(paths, proposalId), null);
}
function bridgeProposalFile(paths, proposalId) {
    return path.join(paths.bridgeProposalsDirectory, `${proposalId}.json`);
}
async function appendBridgeLinkToSourcePage(sourcePageFile, suggestedLink, rationale) {
    const content = await readFile(sourcePageFile, 'utf8');
    if (content.includes(suggestedLink)) {
        return;
    }
    const section = [
        '',
        '## Cross-wiki bridges',
        `- ${suggestedLink} — ${rationale}`,
        '',
    ].join('\n');
    await appendFile(sourcePageFile, section, 'utf8');
}
async function readIntakeItems(paths) {
    const entries = await readdir(paths.intakeItemsDirectory, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const item = await readJsonFile(path.join(paths.intakeItemsDirectory, entry.name), null);
        if (item) {
            items.push(item);
        }
    }
    return items;
}
async function readIntakeItem(paths, itemId) {
    return readJsonFile(intakeItemFile(paths, itemId), null);
}
async function updateIntakeItem(paths, itemId, update, eventType) {
    const item = await readIntakeItem(paths, itemId);
    if (!item) {
        throw new Error(`Intake item does not exist: ${itemId}`);
    }
    const updated = update(item);
    await writeIntakeItem(paths, updated);
    await appendIntakeEvent(paths, {
        type: eventType,
        itemId,
        status: updated.status,
        updatedAt: updated.updatedAt,
    });
    return updated;
}
async function writeIntakeItem(paths, item) {
    await writeJsonFile(intakeItemFile(paths, item.id), item);
}
function intakeItemFile(paths, itemId) {
    return path.join(paths.intakeItemsDirectory, `${itemId}.json`);
}
async function appendIntakeEvent(paths, value) {
    await appendJsonLine(paths.intakeEvents, value);
}
async function findIntakeItemBySource(paths, source) {
    const sourcePath = path.resolve(source);
    const items = await readIntakeItems(paths);
    return items.find((item) => path.resolve(paths.root, item.currentPath) === sourcePath) ?? null;
}
async function findIntakeItemByRouteProposal(paths, proposalId) {
    const items = await readIntakeItems(paths);
    return items.find((item) => item.routeProposalId === proposalId) ?? null;
}
function compareIntakeItems(left, right) {
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
function isTerminalIntakeStatus(status) {
    return status === 'completed' || status === 'rejected' || status === 'parked';
}
function profileProposalFile(paths, proposalId) {
    return path.join(paths.profileProposalsDirectory, `${proposalId}.json`);
}
function markProfileProposalReviewed(proposal, status, reviewer, reason) {
    const now = new Date().toISOString();
    return {
        ...proposal,
        status,
        reviewer: reviewer.trim(),
        reviewedAt: now,
        reason,
        updatedAt: now,
    };
}
async function readRouteDecisions(paths) {
    const entries = await readdir(paths.routingDecisionsDirectory, { withFileTypes: true });
    const decisions = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
            continue;
        }
        const decision = await readJsonFile(path.join(paths.routingDecisionsDirectory, entry.name), null);
        if (!decision) {
            continue;
        }
        decisions.push({
            ...decision,
            proposal: await readJsonFile(path.join(paths.routingProposalsDirectory, `${decision.proposalId}.json`), null),
        });
    }
    return decisions;
}
function profilePositiveTerms(wiki) {
    return [...new Set([
            wiki.id,
            wiki.title,
            ...wiki.aliases,
            ...wiki.scope,
            ...wiki.scopeCore,
            ...wiki.scopeAdjacent,
            ...wiki.conceptAliases.flatMap((group) => [group.canonical, ...group.aliases]),
            ...wiki.exampleAccept,
        ].flatMap(tokenize))];
}
const ROUTE_STRONG_MATCH_SCORE = 5;
const ROUTE_CHILD_PROFILE_SCORE = 4;
const ROUTE_HIGH_CONFIDENCE_SCORE = 8;
const ROUTE_GENERIC_TERMS = new Set([
    'ai',
    'agent',
    'agents',
    'artificial',
    'benchmark',
    'benchmarks',
    'data',
    'dataset',
    'deep',
    'evaluation',
    'foundation',
    'framework',
    'intelligence',
    'language',
    'learning',
    'llm',
    'machine',
    'method',
    'methods',
    'model',
    'modeling',
    'models',
    'multi',
    'network',
    'networks',
    'neural',
    'paper',
    'performance',
    'quantitative',
    'research',
    'series',
    'system',
    'systems',
    'task',
    'tasks',
    'time',
    'training',
    'visual',
    'vision',
]);
function buildBridgeSuggestions(candidates) {
    const strong = candidates.filter((candidate) => isStrongRouteCandidate(candidate));
    if (strong.length < 2) {
        return [];
    }
    const [primary, ...others] = strong;
    return others.slice(0, 2).map((candidate) => ({
        fromWikiId: primary.wikiId,
        toWikiId: candidate.wikiId,
        rationale: `Both wikis scored strongly (${primary.wikiId}: ${primary.score}, ${candidate.wikiId}: ${candidate.score}); prefer explicit bridge links over duplicated canonical pages.`,
    }));
}
function suggestWikiId(title, searchText) {
    const titleTokens = tokenize(title).filter((token) => token.length > 2);
    const tokens = titleTokens.length > 0 ? titleTokens : extractProfileTerms(searchText, title, 3);
    return normalizeWikiId(tokens.slice(0, 3).join('-') || 'new-wiki');
}
function extractProfileTerms(searchText, title, limit) {
    const titleTokens = tokenize(title);
    const counts = new Map();
    for (const token of [...titleTokens, ...tokenize(searchText)]) {
        if (token.length < 3) {
            continue;
        }
        counts.set(token, (counts.get(token) ?? 0) + (titleTokens.includes(token) ? 3 : 1));
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([token]) => token)
        .slice(0, limit);
}
function detectRouteSourceKind(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    if (extension === '.md' || extension === '.markdown' || extension === '.txt') {
        return 'local-file';
    }
    return 'unknown';
}
async function hashIntakeSource(sourcePath) {
    const metadata = await stat(sourcePath);
    const hash = createHash('sha256');
    if (metadata.isDirectory()) {
        await hashDirectory(sourcePath, sourcePath, hash);
    }
    else {
        hash.update(await readFile(sourcePath));
    }
    return hash.digest('hex');
}
async function hashDirectory(root, current, hash) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const absolutePath = path.join(current, entry.name);
        const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
        hash.update(relativePath);
        if (entry.isDirectory()) {
            await hashDirectory(root, absolutePath, hash);
        }
        else if (entry.isFile()) {
            hash.update(await readFile(absolutePath));
        }
    }
}
function taxonomySlugFromFile(filePath) {
    if (!filePath.endsWith('.json')) {
        return null;
    }
    return path.basename(filePath, '.json');
}
function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
async function summarizeSource(input) {
    if (/^[a-z]+:\/\//i.test(input.trim())) {
        return {
            kind: 'url',
            sha256: null,
            title: input.trim(),
            excerpt: input.trim(),
            searchText: input.trim(),
            sourceRole: 'ordinary',
        };
    }
    const absolutePath = path.resolve(input);
    try {
        const content = await readFile(absolutePath, 'utf8');
        return {
            kind: 'local-file',
            sha256: createHash('sha256').update(content).digest('hex'),
            title: extractTitle(content) || path.basename(absolutePath),
            excerpt: normalizeWhitespace(content).slice(0, 1200),
            searchText: `${path.basename(absolutePath)}\n${content}`,
            sourceRole: inferRegistrySourceRole(absolutePath, content),
        };
    }
    catch (error) {
        if (error.code !== 'EISDIR') {
            return {
                kind: 'unknown',
                sha256: null,
                title: path.basename(absolutePath),
                excerpt: absolutePath,
                searchText: absolutePath,
                sourceRole: 'ordinary',
            };
        }
    }
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right)).join('\n');
    return {
        kind: 'directory',
        sha256: createHash('sha256').update(names).digest('hex'),
        title: path.basename(absolutePath),
        excerpt: names.slice(0, 1200),
        searchText: `${path.basename(absolutePath)}\n${names}`,
        sourceRole: 'ordinary',
    };
}
function inferRegistrySourceRole(filePath, content) {
    const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const title = extractTitle(content) || basename;
    const titleLooksLikeIndex = /^(index|contents?|目录|索引)$/i.test(title.trim()) || /(?:index|contents?|目录|索引)/i.test(title.trim()) || basename === 'index';
    if (!titleLooksLikeIndex) {
        return 'ordinary';
    }
    if (basename === 'index' && /(?:index|contents?|目录|索引)/i.test(title.trim())) {
        return 'source-map';
    }
    const body = content.replace(/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '');
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return 'source-map';
    }
    const navigationLines = lines.filter((line) => /^#{1,6}\s+/.test(line) || /^[-*+]\s+/.test(line) || /^\|.+\|$/.test(line) || /\[[^\]]+\]\([^)]*\)/.test(line) || /\[\[[^\]]+\]\]/.test(line) || /`[^`]+\.(?:md|markdown|txt)`/.test(line));
    return navigationLines.length / lines.length >= 0.5 ? 'source-map' : 'ordinary';
}
function rankWikis(searchText, wikis, focusText = searchText) {
    const sourceTokens = routeTokenSet(searchText);
    const normalizedSearchText = normalizePhraseText(searchText);
    const focusedTokens = routeTokenSet(focusText);
    const normalizedFocusText = normalizePhraseText(focusText);
    return wikis
        .map((wiki) => {
        const normalizedWiki = normalizeWikiProfile(wiki);
        const evidence = collectRouteEvidence(normalizedWiki, sourceTokens, normalizedSearchText);
        const focusedEvidence = collectRouteEvidence(normalizedWiki, focusedTokens, normalizedFocusText);
        const negativeTerms = [...new Set(normalizedWiki.outOfScope.flatMap(tokenize))];
        const negativePhraseMatches = normalizedWiki.outOfScope
            .map(normalizePhraseText)
            .filter((phrase) => phrase && phraseMatchesSource(normalizedSearchText, phrase));
        const negativeMatches = [...new Set([
                ...negativePhraseMatches,
                ...negativeTerms.filter((term) => sourceTokens.has(term)),
            ])];
        const negativeScore = negativePhraseMatches.length * 4
            + negativeTerms.filter((term) => sourceTokens.has(term)).reduce((sum, term) => sum + (isGenericRouteTerm(term) ? 0.5 : 2), 0);
        const score = Math.max(0, evidence.score - negativeScore);
        const matchedTerms = [...new Set([
                ...evidence.phraseMatches,
                ...evidence.aliasMatches,
                ...evidence.coreMatches,
                ...evidence.adjacentMatches,
                ...evidence.genericMatches,
            ])];
        return {
            wikiId: normalizedWiki.id,
            title: normalizedWiki.title,
            knowledgeRoot: normalizedWiki.knowledgeRoot,
            score: Number(score.toFixed(2)),
            matchQuality: routeMatchQuality(score, evidence),
            relationshipHint: routeRelationshipHint(score, evidence, focusedEvidence),
            matchedTerms,
            focusedMatches: routeFocusedMatches(focusedEvidence),
            coreMatches: evidence.coreMatches,
            aliasMatches: evidence.aliasMatches,
            phraseMatches: evidence.phraseMatches,
            adjacentMatches: evidence.adjacentMatches,
            genericMatches: evidence.genericMatches,
            negativeMatches,
            rationale: matchedTerms.length > 0
                ? `Matched weighted registry evidence: ${matchedTerms.join(', ')}${negativeMatches.length > 0 ? `; out-of-scope evidence reduced score: ${negativeMatches.join(', ')}` : ''}.`
                : 'No explicit scope terms matched; included as a fallback candidate for human review.',
        };
    })
        .sort((left, right) => right.score - left.score || left.wikiId.localeCompare(right.wikiId));
}
function collectRouteEvidence(wiki, sourceTokens, normalizedSearchText) {
    const corePhrases = wiki.scopeCore;
    const adjacentPhrases = wiki.scopeAdjacent;
    const aliasPhrases = [
        wiki.id,
        wiki.title,
        ...wiki.aliases,
        ...wiki.conceptAliases.flatMap((group) => [group.canonical, ...group.aliases]),
        ...wiki.exampleAccept,
    ];
    const corePhraseMatches = matchedProfilePhrases(corePhrases, normalizedSearchText);
    const adjacentPhraseMatches = matchedProfilePhrases(adjacentPhrases, normalizedSearchText);
    const aliasPhraseMatches = matchedProfilePhrases(aliasPhrases, normalizedSearchText);
    const coreTokenMatches = matchedProfileTokens(corePhrases, sourceTokens);
    const adjacentTokenMatches = matchedProfileTokens(adjacentPhrases, sourceTokens);
    const aliasTokenMatches = matchedProfileTokens(aliasPhrases, sourceTokens);
    const genericMatches = [...new Set([
            ...coreTokenMatches,
            ...adjacentTokenMatches,
            ...aliasTokenMatches,
        ].filter(isGenericRouteTerm))];
    const coreMatches = coreTokenMatches.filter((term) => !isGenericRouteTerm(term));
    const adjacentMatches = adjacentTokenMatches.filter((term) => !isGenericRouteTerm(term));
    const aliasMatches = aliasTokenMatches.filter((term) => !isGenericRouteTerm(term));
    const phraseMatches = [...new Set([
            ...corePhraseMatches,
            ...aliasPhraseMatches,
            ...adjacentPhraseMatches,
        ])];
    const score = corePhraseMatches.length * 5
        + aliasPhraseMatches.length * 5
        + adjacentPhraseMatches.length * 2.5
        + coreMatches.length * 0.8
        + aliasMatches.length * 0.7
        + adjacentMatches.length * 0.3
        + genericMatches.length * 0.1;
    return {
        score,
        coreMatches: [...new Set(coreMatches)],
        aliasMatches: [...new Set(aliasMatches)],
        phraseMatches,
        adjacentMatches: [...new Set(adjacentMatches)],
        genericMatches,
    };
}
function matchedProfilePhrases(phrases, normalizedSearchText) {
    return [...new Set(phrases
            .map(normalizePhraseText)
            .filter((phrase) => {
            const tokens = tokenize(phrase);
            if (tokens.length === 0) {
                return false;
            }
            if (tokens.length === 1 && isGenericRouteTerm(tokens[0])) {
                return false;
            }
            return phraseMatchesSource(normalizedSearchText, phrase);
        }))];
}
function matchedProfileTokens(phrases, sourceTokens) {
    return [...new Set(phrases.flatMap(tokenize).filter((term) => sourceTokens.has(term)))];
}
function routeTokenSet(value) {
    return new Set(tokenize(value).flatMap(routeTokenVariants));
}
function routeTokenVariants(token) {
    const variants = [token];
    if (token.endsWith('ies') && token.length > 4) {
        variants.push(`${token.slice(0, -3)}y`);
    }
    if (token.endsWith('s') && token.length > 4) {
        variants.push(token.slice(0, -1));
    }
    if (token.endsWith('ics') && token.length > 5) {
        variants.push(token.slice(0, -3));
    }
    if (token.endsWith('ic') && token.length > 4) {
        variants.push(token.slice(0, -2));
    }
    return [...new Set(variants)];
}
function routeMatchQuality(score, evidence) {
    if (score <= 0) {
        return 'none';
    }
    if (score >= ROUTE_STRONG_MATCH_SCORE && hasStrongRouteEvidence(evidence)) {
        return 'strong';
    }
    if (score >= 2) {
        return 'moderate';
    }
    return 'weak';
}
function routeRelationshipHint(score, evidence, focusedEvidence) {
    if (score <= 0) {
        return 'unrelated';
    }
    if (score >= ROUTE_STRONG_MATCH_SCORE && hasStrongRouteEvidence(evidence)) {
        return 'same_scheme';
    }
    const focusedNonGenericCount = routeFocusedMatches(focusedEvidence).length;
    if (focusedNonGenericCount >= 1 && score >= ROUTE_CHILD_PROFILE_SCORE) {
        return 'possible_child_profile';
    }
    if (focusedNonGenericCount >= 1 && score >= 2) {
        return 'adjacent_family';
    }
    return 'generic_overlap';
}
function routeFocusedMatches(evidence) {
    return [...new Set([
            ...evidence.phraseMatches,
            ...evidence.aliasMatches,
            ...evidence.coreMatches,
            ...evidence.adjacentMatches,
        ])];
}
function hasStrongRouteEvidence(evidence) {
    return evidence.phraseMatches.length > 0;
}
function isStrongRouteCandidate(candidate) {
    return candidate.score >= ROUTE_STRONG_MATCH_SCORE
        && candidate.matchQuality === 'strong'
        && candidate.phraseMatches.length > 0;
}
function normalizePhraseText(value) {
    return normalizeWhitespace(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')).trim();
}
function phraseMatchesSource(normalizedSearchText, normalizedPhrase) {
    if (!normalizedPhrase) {
        return false;
    }
    return normalizedSearchText === normalizedPhrase
        || normalizedSearchText.startsWith(`${normalizedPhrase} `)
        || normalizedSearchText.endsWith(` ${normalizedPhrase}`)
        || normalizedSearchText.includes(` ${normalizedPhrase} `);
}
function isGenericRouteTerm(term) {
    return ROUTE_GENERIC_TERMS.has(term);
}
function focusedRouteText(source) {
    return `${source.title}\n${source.excerpt}`;
}
function buildRegistryAnswer(question, results) {
    const answered = results.filter((entry) => entry.result && entry.result.citations.length > 0);
    if (answered.length === 0) {
        const errors = results.filter((entry) => entry.error).map((entry) => `${entry.wikiId}: ${entry.error}`).join('; ');
        return `I searched ${results.length} registered wiki(s) for "${question}" but found no cited answer.${errors ? ` Query errors: ${errors}` : ''}`;
    }
    return answered.map((entry) => [
        `## ${entry.title} (${entry.wikiId})`,
        entry.result.answer,
        `Citations: ${entry.result.citations.map((citation) => `${entry.wikiId}:${citation.target}`).join(', ')}`,
    ].join('\n')).join('\n\n');
}
function tokenize(text) {
    return normalizeWhitespace(text)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}
function extractTitle(content) {
    const heading = content.match(/^#\s+(.+)$/m);
    return heading?.[1]?.trim() || null;
}
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function normalizeWikiId(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
function titleFromId(id) {
    return id.split(/[-_.]+/g).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ') || id;
}
function normalizeStringList(values) {
    return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
}
async function ensureTextFile(filePath, initialValue) {
    await mkdir(path.dirname(filePath), { recursive: true });
    if (await exists(filePath)) {
        return;
    }
    await writeFile(filePath, initialValue, 'utf8');
}
async function ensureJsonFile(filePath, initialValue) {
    await mkdir(path.dirname(filePath), { recursive: true });
    if (await exists(filePath)) {
        return;
    }
    await writeJsonFile(filePath, initialValue);
}
async function readJsonFile(filePath, fallback) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}
async function writeJsonFile(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
async function appendJsonLine(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const existing = await exists(filePath) ? await readFile(filePath, 'utf8') : '';
    const needsNewline = existing.length > 0 && !existing.endsWith('\n');
    await writeFile(filePath, `${existing}${needsNewline ? '\n' : ''}${JSON.stringify(value)}\n`, 'utf8');
}
async function exists(targetPath) {
    try {
        await access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
