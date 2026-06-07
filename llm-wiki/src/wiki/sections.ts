export const wikiSectionOrder = ['sources', 'entities', 'concepts', 'syntheses', 'comparisons', 'queries'] as const

export type WikiSection = (typeof wikiSectionOrder)[number]

const wikiSectionTitles: Record<WikiSection, string> = {
  sources: '来源',
  entities: '实体',
  concepts: '概念',
  syntheses: '综合',
  comparisons: '比较',
  queries: '查询',
}

export type WikiPageTarget = {
  section: WikiSection
  slug: string
  target: string
}

export function isWikiSection(value: string): value is WikiSection {
  return wikiSectionOrder.includes(value as WikiSection)
}

export function wikiSectionHeading(section: WikiSection): string {
  return `## ${wikiSectionTitles[section]}`
}

export function wikiSectionRank(section: WikiSection): number {
  return wikiSectionOrder.indexOf(section)
}

export function parseWikiPageTarget(rawTarget: string): WikiPageTarget | null {
  const [section, ...slugParts] = rawTarget.split('/').map((segment) => segment.trim()).filter(Boolean)

  if (!section || slugParts.length === 0 || !isWikiSection(section)) {
    return null
  }

  const slug = slugParts.join('/')
  return {
    section,
    slug,
    target: `${section}/${slug}`,
  }
}
