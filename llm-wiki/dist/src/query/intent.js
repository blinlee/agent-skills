const CROSS_DOMAIN_TERMS = [
    '关系',
    '关联',
    '结合',
    '对比',
    '比较',
    '区别',
    '差异',
    'vs',
    'versus',
    'compare',
    'comparison',
    'relationship',
    'between',
    'combine',
    'integration',
];
export function buildQueryIntent(question, profiles = [], options = {}) {
    const normalized = normalizeIntentText(question);
    const profilesByDomain = normalizeIntentProfiles(profiles);
    const queryScores = scoreQueryDomains(normalized, profilesByDomain);
    const domains = new Set(queryScores
        .filter((entry) => entry.score >= 0.35)
        .map((entry) => entry.domain));
    const explicitCrossDomainIntent = containsAny(normalized, CROSS_DOMAIN_TERMS) && domains.size > 1;
    const dominantDomains = chooseDominantDomains(queryScores, explicitCrossDomainIntent);
    for (const domain of dominantDomains) {
        domains.add(domain);
    }
    const focusedDomains = new Set();
    for (const domain of domains) {
        if (containsAny(normalized, profilesByDomain[domain]?.focus ?? [])) {
            focusedDomains.add(domain);
        }
    }
    return {
        domains,
        dominantDomains,
        profiles: profilesByDomain,
        hasDomainSpecificIntent: domains.size > 0,
        explicitCrossDomainIntent,
        prefersDocumentReading: options.readingMode === 'document',
        focusedDomains,
    };
}
export function scoreEvidenceIntentFit(intent, evidence) {
    if (!intent.hasDomainSpecificIntent) {
        return { score: 0.5, positiveScore: 0.5, negativeScore: 0, margin: 0.5, strong: true, reasons: ['intent:neutral'] };
    }
    const domains = intent.explicitCrossDomainIntent ? [...intent.domains] : intent.dominantDomains;
    const fits = domains
        .map((domain) => intent.profiles[domain])
        .filter((profile) => Boolean(profile))
        .map((profile) => scoreEvidenceForDomain(profile, evidence, intent));
    return fits.sort((left, right) => right.margin - left.margin
        || right.score - left.score
        || Number(right.strong) - Number(left.strong))[0]
        ?? { score: 0, positiveScore: 0, negativeScore: 0, margin: 0, strong: false, reasons: ['intent:no-domain-fit'] };
}
export function isEvidenceDomainConsistent(intent, evidence, options = {}) {
    if (!intent.hasDomainSpecificIntent) {
        return true;
    }
    const score = evidence.score;
    if (options.allowRerankOverride !== false && score && score.rerank >= 0.45) {
        return true;
    }
    const fit = scoreEvidenceIntentFit(intent, evidence);
    const minScore = options.minScore ?? 0.58;
    const minMargin = options.minMargin ?? 0.25;
    if (!fit.strong && score && score.lexical >= 0.18 && score.total >= 0.18) {
        return true;
    }
    return fit.strong && fit.score >= minScore && fit.margin >= minMargin;
}
export function isMeaningfulNonEmbeddingSupport(score) {
    return score.rerank >= 0.25
        || score.lexical >= 0.12
        || score.graph >= 0.1
        || score.taxonomy >= 0.1;
}
export function isEmbeddingOnlyScore(score) {
    return score.embedding > 0
        && score.lexical <= 0
        && score.graph <= 0
        && score.taxonomy <= 0
        && score.metadata <= 0
        && score.rerank <= 0;
}
export function isStrongSemanticEvidence(input) {
    const score = input.evidence.score;
    if (!score) {
        return false;
    }
    if (score.rerank >= 0.35) {
        return true;
    }
    const fit = scoreEvidenceIntentFit(input.intent, input.evidence);
    const minEmbeddingWithDomain = input.minEmbeddingWithDomain ?? 0.45;
    const minEmbeddingWithoutDomain = input.minEmbeddingWithoutDomain ?? 0.68;
    if (input.intent.hasDomainSpecificIntent) {
        return (fit.strong && fit.margin >= 0.25 && fit.score >= 0.58 && score.embedding >= minEmbeddingWithDomain)
            || (fit.margin >= 0.15 && score.embedding >= minEmbeddingWithoutDomain);
    }
    return (score.embedding >= 0.5 && score.total >= 0.18) || score.total >= 0.4;
}
export function isFocusedEvidenceForIntent(intent, evidence) {
    if (intent.focusedDomains.size === 0) {
        return true;
    }
    const text = evidenceText(evidence).full;
    return [...intent.focusedDomains].every((domain) => {
        const focus = intent.profiles[domain]?.focus ?? [];
        return focus.length === 0 || containsAny(text, focus);
    });
}
function scoreQueryDomains(normalizedQuestion, profilesByDomain) {
    return Object.values(profilesByDomain)
        .map((profile) => {
        const core = countMatches(normalizedQuestion, profile.core);
        const support = countMatches(normalizedQuestion, profile.support);
        const generic = countMatches(normalizedQuestion, profile.generic);
        const hasEnoughIdentity = core > 0 || support >= 2 || (support >= 1 && generic >= 2);
        const score = hasEnoughIdentity
            ? clamp01(core * 0.75 + support * 0.35 + Math.min(generic, 2) * 0.12)
            : 0;
        return { domain: profile.domain, score };
    })
        .sort((left, right) => right.score - left.score);
}
function chooseDominantDomains(scores, explicitCrossDomainIntent) {
    const top = scores[0];
    if (!top || top.score <= 0) {
        return [];
    }
    if (explicitCrossDomainIntent) {
        return scores.filter((entry) => entry.score >= 0.35).map((entry) => entry.domain);
    }
    return scores
        .filter((entry) => entry.score >= Math.max(0.35, top.score - 0.15))
        .map((entry) => entry.domain);
}
function scoreEvidenceForDomain(profile, evidence, intent) {
    const text = evidenceText(evidence);
    const identityCore = countMatches(text.identity, profile.core);
    const fullCore = countMatches(text.full, profile.core);
    const identitySupport = countMatches(text.identity, profile.support);
    const fullSupport = countMatches(text.full, profile.support);
    const generic = countMatches(text.full, profile.generic);
    const negative = negativeDomainPressure(profile, text, intent.profiles);
    const positive = clamp01(identityCore * 0.7
        + Math.max(0, fullCore - identityCore) * 0.4
        + identitySupport * 0.25
        + Math.max(0, fullSupport - identitySupport) * 0.15
        + Math.min(generic, 2) * 0.05);
    const focusPenalty = intent.focusedDomains.has(profile.domain) && !containsAny(text.full, profile.focus ?? []) ? 0.35 : 0;
    const negativeScore = clamp01(negative + focusPenalty);
    const margin = Number((positive - negativeScore).toFixed(6));
    const strong = (identityCore > 0 || fullCore > 0 || identitySupport + fullSupport >= 2)
        && margin >= 0.25
        && positive >= 0.45;
    const score = clamp01(positive - negativeScore);
    return {
        score,
        positiveScore: positive,
        negativeScore,
        margin,
        strong,
        domain: profile.domain,
        reasons: [
            `intent:${profile.domain}`,
            `positive:${positive.toFixed(2)}`,
            `negative:${negativeScore.toFixed(2)}`,
            `margin:${margin.toFixed(2)}`,
            strong ? 'strong' : 'weak',
        ],
    };
}
function negativeDomainPressure(profile, text, profilesByDomain) {
    let pressure = 0;
    for (const domain of profile.negative) {
        const negativeProfile = profilesByDomain[domain];
        if (!negativeProfile) {
            continue;
        }
        const identityMatches = countMatches(text.identity, negativeProfile.core);
        const fullMatches = countMatches(text.full, negativeProfile.core);
        pressure += identityMatches * 0.5 + Math.max(0, fullMatches - identityMatches) * 0.25;
    }
    return clamp01(pressure);
}
function normalizeIntentProfiles(profiles) {
    return Object.fromEntries(profiles.map((profile) => [profile.domain, {
            ...profile,
            core: uniqueNormalizedTerms(profile.core),
            support: uniqueNormalizedTerms(profile.support),
            generic: uniqueNormalizedTerms(profile.generic),
            focus: uniqueNormalizedTerms(profile.focus ?? []),
            negative: [...new Set(profile.negative)],
        }]));
}
function uniqueNormalizedTerms(terms) {
    return [...new Set(terms.map(normalizeIntentText).filter(Boolean))];
}
function evidenceText(evidence) {
    const identity = normalizeIntentText([
        evidence.wikiId,
        evidence.wikiTitle,
        evidence.title,
        evidence.heading,
    ].filter(Boolean).join(' '));
    const full = normalizeIntentText([
        identity,
        evidence.excerpt,
    ].filter(Boolean).join(' '));
    return { identity, full };
}
function normalizeIntentText(value) {
    return value.toLowerCase().replace(/[_/|:：,，.。;；()（）\[\]{}]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function containsAny(value, terms) {
    return terms.some((term) => value.includes(term));
}
function countMatches(value, terms) {
    return terms.reduce((count, term) => count + (value.includes(term) ? 1 : 0), 0);
}
function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}
