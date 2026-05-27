const MIN_REVIEW_CONFIDENCE = 0.7;
export async function generateKnowledgeChanges(analysis, options = {}) {
    const sourceSlug = options.sourceSlug ?? buildStableArtifactSlug(analysis);
    const entityCandidates = removeSourceTitleHeuristics(analysis.candidateEntities, sourceSlug);
    const conceptCandidates = removeSourceTitleHeuristics(analysis.candidateConcepts, sourceSlug);
    const sourcePage = {
        slug: sourceSlug,
        title: analysis.artifact.title,
        artifactId: analysis.artifactId,
        topics: [],
        backlinks: [],
        body: buildSourcePageBody(analysis),
    };
    const entityPages = [];
    const conceptPages = [];
    const synthesisSuggestions = [];
    const indexMutations = buildIndexMutations(sourcePage, entityPages, conceptPages);
    const logMutations = [{
            target: 'wiki/log.md',
            op: 'append',
            value: `${analysis.artifact.updatedAt}\tcompiled\t${analysis.artifactId}\t${sourceSlug}`,
        }];
    return {
        artifactId: analysis.artifactId,
        sourcePage,
        entityPages,
        conceptPages,
        synthesisSuggestions,
        indexMutations,
        logMutations,
        taxonomyEffects: buildTaxonomyEffects(analysis.topics, sourcePage),
        reviewEffects: buildReviewEffects(analysis, entityCandidates, conceptCandidates),
    };
}
function buildSourcePageBody(analysis) {
    return [
        `# ${analysis.artifact.title}`,
        '',
        `- Artifact ID: ${analysis.artifactId}`,
        `- Source kind: ${analysis.artifact.sourceKind}`,
        `- Source ref: ${analysis.artifact.sourceRef}`,
        `- Analysis confidence: ${analysis.confidence}`,
        '',
        '## Summary',
        analysis.sourceSummary,
        '',
        '## Evidence preservation',
        'Source of truth: raw captured source material. This page is a derived index/summary and must not replace the raw evidence.',
        '',
        'Semantic candidates are stored in review and taxonomy proposal files until approved. Unapproved candidates are intentionally not linked from this page.',
        '',
        '### Verbatim evidence samples',
        ...selectVerbatimEvidenceSamples(analysis.artifact.content).map((line) => `- ${line}`),
        '',
        '### Caveats / edge-case signals',
        ...selectCaveatSignals(analysis.artifact.content),
        '',
        '## Source excerpt',
        analysis.artifact.content.slice(0, 1200),
    ].join('\n');
}
function selectVerbatimEvidenceSamples(content) {
    const candidates = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .filter((line) => !/^entity\s*:/i.test(line) && !/^concept\s*:/i.test(line));
    return (candidates.length > 0 ? candidates : [content.trim()])
        .filter(Boolean)
        .slice(0, 5)
        .map((line) => line.length > 240 ? `${line.slice(0, 237)}...` : line);
}
function selectCaveatSignals(content) {
    const caveatPattern = /\b(however|but|except|unless|edge case|caveat|risk|conflict|contradict|deprecated|uncertain|unknown)\b/i;
    const caveats = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => caveatPattern.test(line))
        .slice(0, 5)
        .map((line) => `- ${line.length > 240 ? `${line.slice(0, 237)}...` : line}`);
    return caveats.length > 0 ? caveats : ['- None detected; review raw source before treating summary as complete.'];
}
function buildIndexMutations(sourcePage, entityPages, conceptPages) {
    return [
        {
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[sources/${sourcePage.slug}|${sourcePage.title}]]`,
        },
        ...entityPages.map((page) => ({
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[entities/${page.slug}|${page.title}]]`,
        })),
        ...conceptPages.map((page) => ({
            target: 'wiki/index.md',
            op: 'append',
            value: `- [[concepts/${page.slug}|${page.title}]]`,
        })),
    ];
}
function buildTaxonomyEffects(topics, sourcePage) {
    return topics.map((topic) => ({
        action: 'propose-topic',
        slug: topic.slug,
        title: topic.title,
        confidence: topic.confidence,
        rationale: topic.rationale,
        source: {
            slug: sourcePage.slug,
            title: sourcePage.title,
            artifactId: sourcePage.artifactId ?? '',
        },
    }));
}
function buildReviewEffects(analysis, entityCandidates, conceptCandidates) {
    return [
        ...analysis.reviewTriggers.map((trigger) => ({
            ...trigger,
            artifactId: analysis.artifactId,
        })),
        ...entityCandidates.map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'entity', candidate)),
        ...conceptCandidates.map((candidate) => buildCandidateReviewEffect(analysis.artifactId, 'concept', candidate)),
    ];
}
function buildCandidateReviewEffect(artifactId, candidateType, candidate) {
    const lowConfidence = candidate.source === 'heuristic' && candidate.confidence < MIN_REVIEW_CONFIDENCE;
    return {
        artifactId,
        kind: lowConfidence ? 'low-confidence' : 'semantic-candidate',
        severity: 'low',
        reason: lowConfidence
            ? `Low-confidence heuristic ${candidateType} "${candidate.title}" (${candidate.confidence.toFixed(2)}) was gated from durable wiki writes pending review.`
            : `Candidate ${candidateType} "${candidate.title}" (${candidate.confidence.toFixed(2)}) requires review before becoming durable wiki semantics.`,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        candidate: {
            kind: candidateType,
            slug: candidate.slug,
            title: candidate.title,
            confidence: candidate.confidence,
            source: candidate.source,
            evidence: candidate.evidence,
        },
        suggestedActions: [
            `Review whether "${candidate.title}" should become a durable ${candidateType} page.`,
            'Approve, rename/merge, or reject the candidate before hardening it into the wiki.',
        ],
    };
}
function removeSourceTitleHeuristics(candidates, sourceSlug) {
    return candidates.filter((candidate) => !(candidate.source === 'heuristic' && candidate.slug === sourceSlug));
}
function buildStableArtifactSlug(analysis) {
    return stableSlug(analysis.artifact.title, analysis.artifactId);
}
function stableSlug(value, fallback) {
    const slug = slugify(value);
    return slug.length > 0 ? slug : fallback;
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
