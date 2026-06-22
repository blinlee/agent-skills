export function normalizeLegacyRelatedPageSlugs(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const [sourceSlug, entitySlug, conceptSlug] = value.filter((item) => typeof item === 'string' && item.trim().length > 0);
    return [
        sourceSlug ? `sources/${sourceSlug}` : null,
        entitySlug ? `entities/${entitySlug}` : null,
        conceptSlug ? `concepts/${conceptSlug}` : null,
    ].filter((target) => Boolean(target));
}
