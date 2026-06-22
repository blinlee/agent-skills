import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../shared/fs.js';
import { extractProfileTerms } from './classification.js';
import { defaultGranularityPolicy, normalizeWikiId, titleFromId, tokenize } from './helpers.js';
import { findIntakeItemByRouteProposal, readIntakeItem, updateIntakeItem, } from './intake.js';
import { buildBridgeSuggestions, isStrongRouteCandidate, profilePositiveTerms, ROUTE_HIGH_CONFIDENCE_SCORE, ROUTE_STRONG_MATCH_SCORE } from './ranking.js';
export async function classifyRouteProposal(paths, source, candidates, wikis, intakeItem) {
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
            evidence: [`这个材料当前无法读取或格式不支持：${source.title}`],
            risks: ['如果直接收入 wiki，容易产生低质量、无法核验的页面。'],
            humanQuestions: ['是否先把这个材料转换成 Markdown，再重新分类？'],
            newWikiProposalId: null,
            parkReason: null,
            rejectReason: '材料不可读或格式不支持；请先转换，或者明确拒收。',
            bridgeSuggestions: [],
            classificationPolicy: buildClassificationPolicy(criteria),
            routingAssessment: {
                ownershipDecision: 'reject',
                relationshipHint: 'unsupported_source',
                nearestWikiId: null,
                novelty: 'high',
                rationale: '这个材料还不能判断应该放进哪个 wiki，先解决可读性。',
                reviewFocus: ['先转换成 Markdown；如果没有保留价值，就直接拒收。'],
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
                `这个材料更像目录或资料清单：${source.title}。`,
                top ? `最接近的已有 wiki 是 ${top.wikiId}，匹配分 ${top.score}。` : '目前没有明显接近的已有 wiki。',
            ],
            risks: [
                '目录类材料可能只是指向其他文档，本身不一定适合作为正式知识页。',
                '需要判断它应该做导航、拆成多个原始材料，还是直接拒收。',
            ],
            humanQuestions: [
                '这个材料是否应该暂存为导航线索，而不是直接写进 wiki？',
                top ? `如果仍要收入，是否确认由 ${top.wikiId} 负责？` : '如果要收入，应该归到哪个 wiki？',
            ],
            newWikiProposalId: null,
            parkReason: '目录或 source-map 不应自动变成正式 wiki 知识。',
            rejectReason: null,
            bridgeSuggestions: [],
            classificationPolicy: buildClassificationPolicy(criteria),
            routingAssessment: {
                ownershipDecision: 'park',
                relationshipHint: 'source_map',
                nearestWikiId: top?.wikiId ?? null,
                novelty: 'low',
                rationale: '这个材料看起来像导航/索引，不像一条独立知识证据。',
                reviewFocus: ['决定它做导航、拆分 referenced sources，还是拒收。'],
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
                `推荐归入已有 wiki：${top.wikiId}，匹配分 ${top.score}。`,
                `匹配到的关键词/短语：${top.matchedTerms.join(', ') || '无'}。`,
            ],
            risks: bridgeSuggestions.length > 0
                ? ['这个材料横跨多个 wiki；应优先做跨 wiki 连接，避免重复写同一份正式内容。']
                : [],
            humanQuestions: [
                `确认放入 ${top.wikiId}，或者指定另一个 wiki。`,
                '如果它横跨多个 wiki，是否只建立连接而不重复写内容？',
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
                `只有弱匹配的已有 wiki：${top.wikiId}，匹配分 ${top.score}。`,
                `新建 wiki 条件满足 ${criteria.satisfied.length}/${criteria.requiredThreshold}。`,
            ],
            risks: ['强行放入弱匹配 wiki 会污染分类；只凭一个材料新建 wiki 又可能太窄。'],
            humanQuestions: [
                `它只是和 ${top.wikiId} 相邻，还是应该等更多同类材料再决定？`,
            ],
            newWikiProposalId: null,
            parkReason: '已有 wiki 只是弱匹配，新建 wiki 的边界证据也还不够。',
            rejectReason: null,
            bridgeSuggestions,
            classificationPolicy: buildClassificationPolicy(criteria),
            routingAssessment: buildRoutingAssessment('park', top, criteria),
            intakeItemId: intakeItem?.id ?? null,
        };
    }
    const profileSuggestion = await createProfileProposalForSource(paths, {
        source,
        sourcePath: intakeItem ? path.join(paths.root, intakeItem.currentPath ?? source.title) : source.title,
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
            `没有强匹配的已有 wiki；最高匹配分是 ${top?.score ?? 0}。`,
            `已满足的新建 wiki 条件：${criteria.satisfied.join('；') || '无'}。`,
        ],
        risks: [
            '新建 wiki 前需要确认后续还会有同类材料，以及边界足够稳定。',
            second ? `最接近的替代选项是 ${top?.wikiId ?? '无'} 和 ${second.wikiId}；如果查询意图一致，不要无谓拆分。` : '目前没有可比较的已有 wiki。',
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
export async function createProfileProposalForSource(paths, input) {
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
        rationale: '这个材料没有强匹配的已有 wiki。只有当它代表一个长期会继续积累的知识边界时，才应该新建 wiki。',
        evidence: [
            `材料标题：${input.source.title}`,
            `最高候选匹配分：${input.candidates[0]?.score ?? 0}`,
            `建议核心范围：${proposedWiki.scopeCore.join(', ')}`,
        ],
        risks: [
            '范围太宽会把无关材料吸进来。',
            '范围太窄会把知识库切碎，后续查询和跨 wiki 连接都会变重。',
        ],
        reviewQuestions: [
            '这个方向后续是否会持续加入材料？',
            '它更适合做独立 wiki，还是已有 wiki 里的一个主题？',
            '哪些内容必须明确排除，避免以后范围漂移？',
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
export function evaluateNewWikiCriteria(source, candidates) {
    const topScore = candidates[0]?.score ?? 0;
    const hasStrongFit = candidates[0] ? isStrongRouteCandidate(candidates[0]) : false;
    const tokens = [...new Set(tokenize(source.searchText))];
    const satisfied = [
        !hasStrongFit ? '没有已有 wiki 与它强匹配。' : null,
        tokens.length >= 8 ? '材料里有足够多的专门术语，可以初步判断边界。' : null,
        source.excerpt.length >= 160 ? '材料内容足够长，可以判断查询意图和范围。' : null,
        !hasStrongFit && topScore < ROUTE_STRONG_MATCH_SCORE ? '强行塞进已有 wiki 会带来分类污染风险。' : null,
        source.kind !== 'unknown' ? '材料格式可读取，人工确认后可以进入后续流程。' : null,
    ].filter((value) => Boolean(value));
    const all = [
        '没有已有 wiki 与它强匹配。',
        '材料里有足够多的专门术语，可以初步判断边界。',
        '材料内容足够长，可以判断查询意图和范围。',
        '强行塞进已有 wiki 会带来分类污染风险。',
        '材料格式可读取，人工确认后可以进入后续流程。',
    ];
    return {
        satisfied,
        missing: all.filter((criterion) => !satisfied.includes(criterion)),
        requiredThreshold: 3,
    };
}
export function buildClassificationPolicy(criteria) {
    return {
        summary: '只有强匹配才放入已有 wiki；至少满足三个边界条件才建议新建 wiki；否则应暂存或拒收，不要硬塞分类。',
        newWikiRequiredSatisfied: criteria.satisfied,
        newWikiRequiredMissing: criteria.missing,
        requiredSatisfiedCount: criteria.satisfied.length,
        requiredThreshold: criteria.requiredThreshold,
    };
}
export function buildRoutingAssessment(ownershipDecision, top, criteria) {
    const relationshipHint = top?.relationshipHint ?? 'unrelated';
    const novelty = ownershipDecision === 'strong_existing'
        ? 'low'
        : relationshipHint === 'possible_child_profile'
            ? 'medium'
            : relationshipHint === 'same_scheme' || relationshipHint === 'adjacent_family'
                ? 'low'
                : 'high';
    const reviewFocus = [
        top ? `最接近的候选 wiki：${top.wikiId}（${top.matchQuality}，${top.relationshipHint}，分数 ${top.score}）。` : '没有可用的已有 wiki 候选。',
        top && top.focusedMatches.length > 0
            ? `标题/摘要里的明确匹配：${top.focusedMatches.join(', ')}。`
            : '标题/摘要里没有明确匹配；需要确认全文匹配是否只是引用、表格或背景讨论。',
        criteria.satisfied.length > 0
            ? `新建 wiki 条件满足 ${criteria.satisfied.length}/${criteria.requiredThreshold}。`
            : '没有满足新建 wiki 条件。',
    ];
    const rationale = top
        ? routingAssessmentRationale(ownershipDecision, top)
        : '当前没有已注册 wiki，因此需要新建 profile 提案，或者先暂存。';
    return {
        ownershipDecision,
        relationshipHint,
        nearestWikiId: top?.wikiId ?? null,
        novelty,
        rationale,
        reviewFocus,
    };
}
export function routingAssessmentRationale(ownershipDecision, top) {
    if (ownershipDecision === 'strong_existing') {
        return `可以建议放入 ${top.wikiId}，因为它和该 wiki 的范围证据强匹配。`;
    }
    if (ownershipDecision === 'park') {
        return `最接近的是 ${top.wikiId}，但证据不足以强行归属，也不足以自动新建稳定边界。`;
    }
    if (top.relationshipHint === 'possible_child_profile') {
        return `它和 ${top.wikiId} 有关，但更像一个相邻/子领域，不适合直接放进去。`;
    }
    if (top.relationshipHint === 'adjacent_family') {
        return `它靠近 ${top.wikiId}，但已有范围证据还不够支持直接归属。`;
    }
    if (top.relationshipHint === 'generic_overlap') {
        return `${top.wikiId} 的匹配主要来自泛词或全文弱重合，只能作为审核线索。`;
    }
    return '这个材料看起来不属于任何已有 wiki。';
}
export function buildDraftWikiProfile(input) {
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
            '没有后续材料预期的单篇暂存内容',
            '主要查询意图属于其他已注册 wiki 的材料',
        ],
        aliases: [input.source.title].filter(Boolean),
        conceptAliases: core.slice(0, 4).map((term) => ({ canonical: term, aliases: [] })),
        granularity: defaultGranularityPolicy(),
        exampleAccept: [input.source.title],
        exampleReject: [],
        profileNotes: [
            '该草稿来自单个材料，接受前需要人工收紧范围。',
            'Wiki 边界是治理和检索边界，不是普通文件夹分类。',
        ],
        createdAt: input.now,
        updatedAt: input.now,
    };
}
export function suggestWikiId(title, searchText) {
    const titleTokens = tokenize(title).filter((token) => token.length > 2);
    const tokens = titleTokens.length > 0 ? titleTokens : extractProfileTerms(searchText, title, 3);
    return normalizeWikiId(tokens.slice(0, 3).join('-') || 'new-wiki');
}
export function taxonomySlugFromFile(filePath) {
    if (!filePath.endsWith('.json')) {
        return null;
    }
    return path.basename(filePath, '.json');
}
export async function updateIntakeItemAfterRouteAcceptance(paths, proposal, ingestResult, wikiId, reviewer) {
    const item = proposal.intakeItemId
        ? await readIntakeItem(paths, proposal.intakeItemId)
        : await findIntakeItemByRouteProposal(paths, proposal.id);
    if (!item) {
        return;
    }
    const terminalFailure = ingestResult.status === 'failed_terminal' || ingestResult.status === 'failed_retryable' || ingestResult.status === 'rejected';
    const taxonomyProposalSlugs = ingestResult.taxonomyFiles.map(taxonomySlugFromFile).filter((slug) => Boolean(slug));
    const now = new Date().toISOString();
    const status = terminalFailure ? 'blocked' : 'completed';
    await updateIntakeItem(paths, item.id, (current) => ({
        ...current,
        status,
        targetWikiId: wikiId,
        routeProposalId: proposal.id,
        taxonomyProposalSlugs,
        wikiPages: ingestResult.writtenFiles,
        managedRawArchive: ingestResult.archivePath ?? ingestResult.retainedPath ?? ingestResult.rejectedPath,
        reviewRequired: terminalFailure,
        lastError: terminalFailure ? `ingest status: ${ingestResult.status}` : null,
        reviewer,
        completedAt: terminalFailure ? current.completedAt : now,
        updatedAt: now,
    }), 'route-accepted');
}
export function profileProposalFile(paths, proposalId) {
    return path.join(paths.profileProposalsDirectory, `${proposalId}.json`);
}
export function markProfileProposalReviewed(proposal, status, reviewer, reason) {
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
export async function readRouteDecisions(paths) {
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
