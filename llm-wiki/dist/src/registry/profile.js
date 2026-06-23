import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../shared/fs.js';
import { normalizeWikiId, titleFromId, tokenize } from './helpers.js';
import { readIntakeItem } from './intake.js';
import { resolveRegistryPaths } from './paths.js';
import { buildDraftWikiProfile, evaluateNewWikiCriteria, markProfileProposalReviewed, profileProposalFile, readRouteDecisions, suggestWikiId, } from './proposal.js';
import { profilePositiveTerms, rankWikis } from './ranking.js';
import { readRegistryState, runRegistryAdd, runRegistryInit } from './state.js';
import { summarizeSource } from './source.js';
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
    const candidates = rankWikis(source.searchText, state.wikis, `${source.title}\n${source.excerpt}`);
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
        rationale: '当材料没有强匹配的已有 wiki 时，不应静默扩大某个 wiki 的范围。这个提案只是一个待人工确认的 wiki 边界草稿。',
        evidence: [
            `材料标题：${source.title}`,
            `最接近的已有候选：${candidates[0]?.wikiId ?? '无'}（${candidates[0]?.score ?? 0}）`,
            `草稿核心范围：${proposedWiki.scopeCore.join(', ') || proposedWiki.title}`,
        ],
        risks: [
            '如果后续不会持续加入同类材料，只凭一个材料新建 wiki 可能太窄。',
            '如果接受过宽的 profile，后续分类和检索都会被污染。',
        ],
        reviewQuestions: [
            '这个方向后续是否会继续收集材料？',
            '它是一个独立治理边界，还是已有 wiki 里的一个主题？',
            '排除范围是否足够清楚，能防止以后漂移？',
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
            const accepted = decisions.filter((decision) => decision.status === 'accepted' && decision.acceptedWikiId === wiki.id);
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
                    weakAccepted.length > 0 ? `${weakAccepted.length} 条已接受路由只有弱匹配；建议检查是否要收紧范围或补充别名。` : null,
                    wiki.scopeCore.length === 0 ? '这个 profile 没有核心范围；当前路由过度依赖标题/id。' : null,
                ].filter((value) => Boolean(value)),
            };
        }),
        guidance: [
            'profile 变更必须先作为提案审核：不要因为一个材料勉强匹配，就静默扩大某个 wiki。',
            '如果反复接受同类材料，优先补别名；只有当术语、查询意图、材料标准、规模和污染风险都支持时，才拆分或新建 wiki。',
            '如果某个 wiki 累积了很多弱匹配收入项，请检查它是范围太宽、太窄，还是缺少相邻范围说明。',
        ],
    };
}
