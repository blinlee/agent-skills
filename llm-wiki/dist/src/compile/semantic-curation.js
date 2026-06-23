import { readFile } from 'node:fs/promises';
export async function loadSemanticCurationPlan(filePath) {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return normalizeSemanticCurationPlan(parsed);
}
export function normalizeSemanticCurationPlan(value) {
    if (!isRecord(value)) {
        throw new Error('semantic curation plan must be a JSON object');
    }
    if (value.schema !== 'llm-wiki.semantic-curation.v1') {
        throw new Error('semantic curation plan schema must be llm-wiki.semantic-curation.v1');
    }
    if (value.status !== 'ready' && value.status !== 'needs_review') {
        throw new Error('semantic curation plan status must be ready or needs_review');
    }
    return {
        schema: 'llm-wiki.semantic-curation.v1',
        status: value.status,
        summary: requiredString(value.summary, 'summary'),
        entities: normalizeEntities(value.entities),
        concepts: normalizeConcepts(value.concepts),
        syntheses: normalizeSyntheses(value.syntheses),
        rejections: normalizeRejections(value.rejections),
        notes: normalizeNotes(value.notes),
    };
}
export function validateSemanticCurationPlan(input) {
    const plan = {
        ...input.plan,
        syntheses: input.plan.syntheses ?? [],
        rejections: input.plan.rejections ?? [],
        notes: input.plan.notes ?? [],
    };
    const errors = [];
    if (plan.status === 'ready') {
        const acceptedCount = plan.entities.length + plan.concepts.length + plan.syntheses.length;
        if (acceptedCount === 0 && plan.rejections.length === 0 && plan.notes.length === 0) {
            errors.push('ready semantic curation must either accept pages or explain why none should be created');
        }
    }
    const scopedSlugs = new Set();
    for (const item of plan.entities) {
        validateCuratedNode('entity', item, input.artifact, scopedSlugs, errors);
    }
    for (const item of plan.concepts) {
        validateCuratedNode('concept', item, input.artifact, scopedSlugs, errors);
    }
    for (const item of plan.syntheses) {
        validateCuratedNode('synthesis', item, input.artifact, scopedSlugs, errors);
    }
    for (const rejection of plan.rejections) {
        if (!rejection.text.trim())
            errors.push('rejection text must not be empty');
        if (!rejection.reason.trim())
            errors.push(`rejection ${rejection.text || '<empty>'} must explain the reason`);
    }
    if (errors.length > 0) {
        throw new Error(`invalid semantic curation plan: ${errors.join('; ')}`);
    }
    return plan;
}
export function semanticCurationNeedsReviewReasons(plan) {
    if (plan.status !== 'needs_review') {
        return [];
    }
    const notes = [
        ...plan.notes ?? [],
        ...plan.rejections?.map((rejection) => `${rejection.text}: ${rejection.reason}`) ?? [],
    ].map((value) => value.trim()).filter(Boolean);
    return notes.length > 0 ? notes : ['semantic curation plan marked status as needs_review'];
}
function validateCuratedNode(section, item, artifact, scopedSlugs, errors) {
    if (!item.title.trim())
        errors.push(`${section} title must not be empty`);
    if (!item.description.trim())
        errors.push(`${section} ${item.title || '<empty>'} needs a Chinese description`);
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
        errors.push(`${section} ${item.title || '<empty>'} needs at least one source quote`);
    }
    const slug = item.slug ? normalizeSlug(item.slug) : slugify(item.title);
    if (item.slug && slug !== item.slug) {
        errors.push(`${section} ${item.title} slug must already be normalized: ${slug}`);
    }
    if (slug && scopedSlugs.has(`${section}:${slug}`)) {
        errors.push(`${section} slug is duplicated: ${slug}`);
    }
    if (slug) {
        scopedSlugs.add(`${section}:${slug}`);
    }
    for (const evidence of item.evidence) {
        if (!evidence.quote.trim()) {
            errors.push(`${section} ${item.title || '<empty>'} has empty evidence quote`);
            continue;
        }
        if (!sourceIncludesQuote(artifact.content, evidence.quote)) {
            errors.push(`${section} ${item.title || '<empty>'} evidence quote is not present in the source: ${evidence.quote.slice(0, 80)}`);
        }
    }
}
function normalizeEntities(value) {
    return normalizeArray(value, 'entities').map((item, index) => {
        if (!isRecord(item))
            throw new Error(`entities[${index}] must be an object`);
        return {
            title: requiredString(item.title, `entities[${index}].title`),
            slug: optionalString(item.slug),
            kind: normalizeEntityKind(item.kind),
            description: requiredString(item.description, `entities[${index}].description`),
            evidence: normalizeEvidence(item.evidence, `entities[${index}].evidence`),
        };
    });
}
function normalizeConcepts(value) {
    return normalizeArray(value, 'concepts').map((item, index) => {
        if (!isRecord(item))
            throw new Error(`concepts[${index}] must be an object`);
        return {
            title: requiredString(item.title, `concepts[${index}].title`),
            slug: optionalString(item.slug),
            description: requiredString(item.description, `concepts[${index}].description`),
            evidence: normalizeEvidence(item.evidence, `concepts[${index}].evidence`),
        };
    });
}
function normalizeSyntheses(value) {
    return normalizeArray(value, 'syntheses').map((item, index) => {
        if (!isRecord(item))
            throw new Error(`syntheses[${index}] must be an object`);
        return {
            title: requiredString(item.title, `syntheses[${index}].title`),
            slug: optionalString(item.slug),
            description: requiredString(item.description, `syntheses[${index}].description`),
            evidence: normalizeEvidence(item.evidence, `syntheses[${index}].evidence`),
        };
    });
}
function normalizeRejections(value) {
    return normalizeArray(value, 'rejections').map((item, index) => {
        if (!isRecord(item))
            throw new Error(`rejections[${index}] must be an object`);
        return {
            text: requiredString(item.text, `rejections[${index}].text`),
            reason: requiredString(item.reason, `rejections[${index}].reason`),
        };
    });
}
function normalizeNotes(value) {
    return normalizeArray(value, 'notes').map((item, index) => requiredString(item, `notes[${index}]`));
}
function normalizeEvidence(value, path) {
    return normalizeArray(value, path).map((item, index) => {
        if (!isRecord(item))
            throw new Error(`${path}[${index}] must be an object`);
        return {
            quote: requiredString(item.quote, `${path}[${index}].quote`),
            note: optionalString(item.note),
        };
    });
}
function normalizeArray(value, name) {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`${name} must be an array`);
    }
    return value;
}
function normalizeEntityKind(value) {
    const allowed = new Set([
        'paper',
        'system',
        'model',
        'dataset',
        'benchmark',
        'tool',
        'project',
        'organization',
        'person',
        'method',
        'other',
    ]);
    if (typeof value !== 'string' || !allowed.has(value)) {
        throw new Error(`entity kind must be one of ${[...allowed].join(', ')}`);
    }
    return value;
}
function sourceIncludesQuote(source, quote) {
    return normalizeForQuoteSearch(source).includes(normalizeForQuoteSearch(quote));
}
function normalizeForQuoteSearch(value) {
    return value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requiredString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
    return value.trim();
}
function optionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
export function normalizeSlug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function slugify(value) {
    return normalizeSlug(value);
}
