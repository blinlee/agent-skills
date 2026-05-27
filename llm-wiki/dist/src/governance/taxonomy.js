import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureKnowledgeRootLayout } from '../paths.js';
import { updateWikiIndex } from '../wiki/index-log.js';
export async function listTaxonomyProposals(root) {
    const paths = await ensureKnowledgeRootLayout(root);
    const proposalDirectory = path.join(paths.taxonomyDirectory, 'proposals');
    const proposalFiles = (await readdir(proposalDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(proposalDirectory, entry.name))
        .sort((left, right) => left.localeCompare(right));
    const proposals = [];
    for (const filePath of proposalFiles) {
        const proposal = await readJsonFile(filePath, null);
        if (!proposal) {
            continue;
        }
        proposals.push(summarizeProposalForReview(paths.topicRegistry, paths.taxonomyAliases, filePath, proposal));
    }
    return {
        knowledgeRoot: paths.root,
        proposalCount: proposals.length,
        pendingCount: proposals.filter((proposal) => proposal.status === 'proposed' || proposal.reviewRequired).length,
        acceptedCount: proposals.filter((proposal) => proposal.status === 'accepted').length,
        rejectedCount: proposals.filter((proposal) => proposal.status === 'rejected').length,
        proposals,
    };
}
export async function rejectTaxonomyProposal(root, input) {
    const paths = await ensureKnowledgeRootLayout(root);
    const proposalPath = path.join(paths.taxonomyDirectory, 'proposals', `${input.slug}.json`);
    const proposal = await readJsonFile(proposalPath, null);
    if (!proposal) {
        throw new Error(`Taxonomy proposal does not exist: ${input.slug}`);
    }
    if (!input.reviewer.trim()) {
        throw new Error('Taxonomy proposal rejection requires a non-empty human reviewer.');
    }
    if (proposal.status === 'accepted') {
        throw new Error(`Taxonomy proposal is already accepted and cannot be rejected without an explicit reversal workflow: ${input.slug}`);
    }
    const now = new Date().toISOString();
    const rejectionReason = input.reason?.trim() ?? '';
    const rejectedProposal = {
        ...proposal,
        status: 'rejected',
        canonicalized: false,
        reviewRequired: false,
        reviewer: input.reviewer.trim(),
        reviewedAt: now,
        updatedAt: now,
        rationale: proposal.status === 'rejected' || !rejectionReason
            ? proposal.rationale
            : `${proposal.rationale}\n\nRejected: ${rejectionReason}`,
    };
    await writeJsonFile(proposalPath, rejectedProposal);
    return {
        files: [proposalPath],
    };
}
export async function applyTaxonomyEffects(root, input) {
    const paths = await ensureKnowledgeRootLayout(root);
    const taxonomyRoot = paths.taxonomyDirectory;
    const proposalDirectory = path.join(taxonomyRoot, 'proposals');
    const files = [paths.topicRegistry, paths.taxonomyAliases];
    const proposals = input.topicProposals.map(materializeProposal);
    attachBridgeSuggestions(proposals);
    for (const proposal of proposals) {
        const proposalPath = path.join(proposalDirectory, `${proposal.slug}.json`);
        const existingProposal = await readJsonFile(proposalPath, null);
        if (existingProposal?.status === 'accepted') {
            files.push(proposalPath);
            const evidenceFiles = await persistAcceptedTopicEvidenceProposals(taxonomyRoot, existingProposal, proposal);
            files.push(...evidenceFiles);
            continue;
        }
        await writeJsonFile(proposalPath, existingProposal ? mergeProposalEvidence(existingProposal, proposal) : proposal);
        files.push(proposalPath);
    }
    await ensureJsonFile(paths.topicRegistry, { topics: [] });
    await ensureJsonFile(paths.taxonomyAliases, { aliases: {} });
    return {
        proposalCount: input.topicProposals.length,
        files,
    };
}
export async function acceptTaxonomyProposal(root, input) {
    const paths = await ensureKnowledgeRootLayout(root);
    const proposalPath = path.join(paths.taxonomyDirectory, 'proposals', `${input.slug}.json`);
    const proposal = await readJsonFile(proposalPath, null);
    if (!proposal) {
        throw new Error(`Taxonomy proposal does not exist: ${input.slug}`);
    }
    if (!input.reviewer.trim()) {
        throw new Error('Taxonomy proposal acceptance requires a non-empty human reviewer.');
    }
    const conceptPagePath = conceptPagePathFor(paths.root, proposal.slug);
    if (proposal.status === 'accepted') {
        return {
            files: [paths.topicRegistry, paths.taxonomyAliases, proposalPath, conceptPagePath, paths.wikiIndex],
        };
    }
    if (proposal.status === 'rejected') {
        throw new Error(`Taxonomy proposal is rejected and cannot be accepted without a new proposal: ${input.slug}`);
    }
    const registry = await readJsonFile(paths.topicRegistry, { topics: [] });
    const aliases = await readJsonFile(paths.taxonomyAliases, { aliases: {} });
    const acceptedProposal = {
        ...proposal,
        status: 'accepted',
        canonicalized: true,
        reviewRequired: false,
        sources: dedupeSources(proposal.sources ?? []),
        reviewer: input.reviewer.trim(),
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    upsertTopicRegistryEntry(registry, acceptedProposal);
    mergeAliases(aliases, acceptedProposal);
    await writeAcceptedConceptPage(paths.root, acceptedProposal);
    const indexPath = await updateWikiIndex(paths.root, {
        addEntries: [`- [[concepts/${acceptedProposal.slug}|${acceptedProposal.name}]]`],
    });
    await writeJsonFile(paths.topicRegistry, registry);
    await writeJsonFile(paths.taxonomyAliases, aliases);
    await writeJsonFile(proposalPath, acceptedProposal);
    return {
        files: [paths.topicRegistry, paths.taxonomyAliases, proposalPath, conceptPagePath, indexPath],
    };
}
function summarizeProposalForReview(topicRegistryPath, aliasesPath, filePath, proposal) {
    const conceptPath = path.join(path.dirname(path.dirname(topicRegistryPath)), 'wiki', 'concepts', `${proposal.slug}.md`);
    const effect = proposal.status === 'accepted'
        ? `Topic "${proposal.name}" (${proposal.slug}) is already accepted; re-running accept is idempotent and will not rewrite the accepted concept page.`
        : `Accepting will add or update canonical topic "${proposal.name}" (${proposal.slug}), merge ${proposal.aliases.length} alias(es), and materialize one accepted concept page.`;
    return {
        slug: proposal.slug,
        name: proposal.name,
        status: proposal.status,
        confidence: proposal.confidence,
        rationale: proposal.rationale,
        aliases: proposal.aliases,
        parentCandidates: proposal.parentCandidates,
        bridgeSuggestions: proposal.bridgeSuggestions,
        sources: proposal.sources ?? [],
        reviewRequired: proposal.reviewRequired,
        canonicalized: proposal.canonicalized,
        reviewer: proposal.reviewer,
        reviewedAt: proposal.reviewedAt,
        proposedOperation: {
            action: 'canonicalize-topic',
            effect,
            writes: [topicRegistryPath, aliasesPath, filePath, conceptPath],
        },
        filePath,
    };
}
function materializeProposal(input) {
    const now = new Date().toISOString();
    const normalizedAliases = [...new Set((input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];
    const slug = slugify(input.name);
    return {
        name: input.name,
        slug,
        confidence: Number(input.confidence.toFixed(2)),
        rationale: input.rationale ?? 'Derived from governance taxonomy side effects.',
        aliases: normalizedAliases,
        parentCandidates: buildParentCandidates(input.name, slug),
        bridgeSuggestions: [],
        sources: dedupeSources(input.sources ?? []),
        status: 'proposed',
        canonicalized: false,
        reviewRequired: true,
        reviewer: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
    };
}
function mergeProposalEvidence(existing, next) {
    return {
        ...existing,
        confidence: Number(Math.max(existing.confidence, next.confidence).toFixed(2)),
        aliases: [...new Set([...existing.aliases, ...next.aliases])],
        parentCandidates: mergeCandidateLists(existing.parentCandidates, next.parentCandidates),
        sources: dedupeSources([...(existing.sources ?? []), ...next.sources]),
        updatedAt: next.updatedAt,
    };
}
async function persistAcceptedTopicEvidenceProposals(taxonomyRoot, acceptedProposal, nextProposal) {
    const files = [];
    const acceptedSources = new Set((acceptedProposal.sources ?? []).map(sourceIdentity));
    for (const source of nextProposal.sources) {
        if (acceptedSources.has(sourceIdentity(source))) {
            continue;
        }
        const evidenceProposal = materializeEvidenceProposal(acceptedProposal, nextProposal, source);
        const evidencePath = path.join(taxonomyRoot, 'evidence-proposals', acceptedProposal.slug, `${buildEvidenceProposalSlug(source)}.json`);
        const existingEvidence = await readJsonFile(evidencePath, null);
        if (existingEvidence && existingEvidence.status !== 'pending') {
            files.push(evidencePath);
            continue;
        }
        await writeJsonFile(evidencePath, existingEvidence
            ? mergeEvidenceProposal(existingEvidence, evidenceProposal)
            : evidenceProposal);
        files.push(evidencePath);
    }
    return files;
}
function materializeEvidenceProposal(acceptedProposal, nextProposal, source) {
    const now = new Date().toISOString();
    return {
        topicSlug: acceptedProposal.slug,
        topicName: acceptedProposal.name,
        source,
        rationale: nextProposal.rationale,
        confidence: nextProposal.confidence,
        status: 'pending',
        reviewRequired: true,
        reviewer: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
    };
}
function mergeEvidenceProposal(existing, next) {
    return {
        ...existing,
        rationale: existing.rationale === next.rationale
            ? existing.rationale
            : `${existing.rationale}\n\nAdditional rationale: ${next.rationale}`,
        confidence: Number(Math.max(existing.confidence, next.confidence).toFixed(2)),
        updatedAt: next.updatedAt,
    };
}
function sourceIdentity(source) {
    return `${source.slug}\0${source.artifactId}`;
}
function buildEvidenceProposalSlug(source) {
    const readable = slugify(source.slug || source.title || 'source');
    const hash = createHash('sha1').update(`${source.slug}\n${source.artifactId}\n${source.title}`).digest('hex').slice(0, 10);
    return `${readable || 'source'}-${hash}`;
}
function mergeCandidateLists(left, right) {
    const bySlug = new Map();
    for (const candidate of [...left, ...right]) {
        const existing = bySlug.get(candidate.slug);
        if (!existing || candidate.confidence > existing.confidence) {
            bySlug.set(candidate.slug, candidate);
        }
    }
    return [...bySlug.values()];
}
function dedupeSources(sources) {
    const bySlug = new Map();
    for (const source of sources) {
        if (!source.slug.trim()) {
            continue;
        }
        bySlug.set(source.slug, {
            slug: source.slug,
            title: source.title,
            artifactId: source.artifactId,
        });
    }
    return [...bySlug.values()];
}
function upsertTopicRegistryEntry(registry, proposal) {
    const existing = registry.topics.find((topic) => topic.slug === proposal.slug);
    if (existing) {
        existing.name = proposal.name;
        existing.confidence = proposal.confidence;
        existing.rationale = proposal.rationale;
        existing.updatedAt = proposal.updatedAt;
        return;
    }
    registry.topics.push({
        slug: proposal.slug,
        name: proposal.name,
        confidence: proposal.confidence,
        rationale: proposal.rationale,
        updatedAt: proposal.updatedAt,
    });
}
function mergeAliases(aliasesState, proposal) {
    for (const alias of proposal.aliases) {
        const normalizedAlias = slugify(alias);
        if (!normalizedAlias) {
            continue;
        }
        aliasesState.aliases[normalizedAlias] = proposal.slug;
    }
}
function buildParentCandidates(name, ownSlug) {
    const words = name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3);
    const candidates = new Map();
    for (const word of words.slice(1)) {
        const slug = slugify(word);
        if (!slug || slug === ownSlug) {
            continue;
        }
        candidates.set(slug, {
            slug,
            name: word,
            confidence: 0.45,
            rationale: `Derived as a possible parent topic from "${name}".`,
        });
    }
    return [...candidates.values()];
}
function attachBridgeSuggestions(proposals) {
    for (const proposal of proposals) {
        proposal.bridgeSuggestions = proposals
            .filter((candidate) => candidate.slug !== proposal.slug)
            .map((candidate) => ({
            slug: candidate.slug,
            name: candidate.name,
            confidence: Number(Math.min(proposal.confidence, candidate.confidence, 0.66).toFixed(2)),
            rationale: `Co-proposed with "${proposal.name}" in the same taxonomy side-effect batch.`,
        }));
    }
}
async function writeAcceptedConceptPage(knowledgeRoot, proposal) {
    const conceptPath = conceptPagePathFor(knowledgeRoot, proposal.slug);
    await mkdir(path.dirname(conceptPath), { recursive: true });
    try {
        await access(conceptPath);
        return conceptPath;
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    await writeFile(conceptPath, formatAcceptedConceptPage(proposal), 'utf8');
    return conceptPath;
}
function conceptPagePathFor(knowledgeRoot, slug) {
    return path.join(path.resolve(knowledgeRoot), 'wiki', 'concepts', `${slug}.md`);
}
function formatAcceptedConceptPage(proposal) {
    const now = new Date().toISOString();
    const sourceLinks = proposal.sources.length > 0
        ? proposal.sources.map((source) => `- [[sources/${source.slug}|${source.title}]]`).join('\n')
        : '- None recorded';
    return [
        '---',
        `title: ${JSON.stringify(proposal.name)}`,
        `created: ${JSON.stringify(proposal.createdAt)}`,
        `updated: ${JSON.stringify(now)}`,
        'type: "concept"',
        `tags: ${JSON.stringify([proposal.slug])}`,
        `sources: ${JSON.stringify(proposal.sources.map((source) => source.artifactId).filter(Boolean))}`,
        'confidence: "medium"',
        'contested: false',
        '---',
        `# ${proposal.name}`,
        '',
        `- Canonical slug: ${proposal.slug}`,
        `- Review status: accepted by ${proposal.reviewer ?? 'unknown reviewer'} at ${proposal.reviewedAt ?? now}`,
        `- Confidence: ${proposal.confidence}`,
        '',
        '## Scope note',
        proposal.rationale,
        '',
        '## Aliases',
        ...(proposal.aliases.length > 0 ? proposal.aliases.map((alias) => `- ${alias}`) : ['- None recorded']),
        '',
        '## Source evidence',
        sourceLinks,
    ].join('\n').trimEnd() + '\n';
}
async function readJsonFile(targetPath, fallback) {
    try {
        const raw = await readFile(targetPath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}
async function ensureJsonFile(targetPath, fallback) {
    try {
        await readFile(targetPath, 'utf8');
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        await writeJsonFile(targetPath, fallback);
    }
}
async function writeJsonFile(targetPath, value) {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify(value, null, 2), 'utf8');
}
function slugify(value) {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (normalized) {
        return normalized;
    }
    return `topic-${createHash('sha1').update(value).digest('hex').slice(0, 12)}`;
}
