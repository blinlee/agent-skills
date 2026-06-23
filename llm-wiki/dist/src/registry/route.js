import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { runIngestJob } from '../jobs/job-runner.js';
import { readJsonFile, writeJsonFile } from '../shared/fs.js';
import { buildClassificationPackage } from './classification.js';
import { normalizeWikiId } from './helpers.js';
import { findIntakeItemBySource, runIntakeScan, updateIntakeItem } from './intake.js';
import { resolveRegistryPaths } from './paths.js';
import { classifyRouteProposal, updateIntakeItemAfterRouteAcceptance } from './proposal.js';
import { rankWikis } from './ranking.js';
import { createBridgeProposalsAfterRouteAccept } from './bridge.js';
import { readRegistryState, runRegistryInit } from './state.js';
import { summarizeSource } from './source.js';
export async function runRoute(input) {
    const paths = resolveRegistryPaths(input.registryRoot);
    await runRegistryInit({ registryRoot: paths.root });
    const state = await readRegistryState(paths);
    const source = await summarizeSource(input.source);
    const candidates = rankWikis(source.searchText, state.wikis, source.title ? `${source.title}\n${source.excerpt}` : source.searchText);
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
    const ingestResult = await runIngestJob({
        knowledgeRoot: wiki.knowledgeRoot,
        input: proposal.source.input,
        qualityPath: input.qualityPath,
        curationPath: input.curationPath,
    });
    const now = new Date().toISOString();
    const ingestCompleted = ingestResult.status === 'completed';
    const decisionStatus = ingestCompleted ? 'accepted' : 'blocked';
    const acceptedProposal = {
        ...proposal,
        status: 'accepted',
        acceptedWikiId: wiki.id,
        reviewer,
        reviewedAt: now,
        updatedAt: now,
    };
    const decision = {
        status: decisionStatus,
        proposalId: proposal.id,
        acceptedWikiId: wiki.id,
        reviewer,
        decidedAt: now,
        ingestResult,
    };
    const decisionFile = path.join(paths.routingDecisionsDirectory, ingestCompleted ? `${proposal.id}.json` : `${proposal.id}.blocked.json`);
    if (ingestCompleted) {
        await writeJsonFile(proposalFile, acceptedProposal);
    }
    await writeJsonFile(decisionFile, decision);
    await updateIntakeItemAfterRouteAcceptance(paths, ingestCompleted ? acceptedProposal : proposal, ingestResult, wiki.id, reviewer);
    const bridgeProposalFiles = ingestCompleted
        ? await createBridgeProposalsAfterRouteAccept(paths, acceptedProposal, ingestResult, wiki.id)
        : [];
    return {
        registryRoot: paths.root,
        proposalFile,
        decisionFile,
        bridgeProposalFiles,
        decision,
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
