export const wikiSectionOrder = ['sources', 'readings', 'entities', 'concepts', 'syntheses', 'comparisons', 'queries', 'bridges'];
const wikiSectionTitles = {
    sources: '来源',
    readings: '原文',
    entities: '实体',
    concepts: '概念',
    syntheses: '综合',
    comparisons: '比较',
    queries: '查询',
    bridges: '跨 wiki 连接',
};
export function isWikiSection(value) {
    return wikiSectionOrder.includes(value);
}
export function wikiSectionHeading(section) {
    return `## ${wikiSectionTitles[section]}`;
}
export function wikiSectionRank(section) {
    return wikiSectionOrder.indexOf(section);
}
export function parseWikiPageTarget(rawTarget) {
    const [section, ...slugParts] = rawTarget.split('/').map((segment) => segment.trim()).filter(Boolean);
    if (!section || slugParts.length === 0 || !isWikiSection(section)) {
        return null;
    }
    const slug = slugParts.join('/');
    return {
        section,
        slug,
        target: `${section}/${slug}`,
    };
}
