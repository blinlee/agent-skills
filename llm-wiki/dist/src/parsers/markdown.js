import { createParsedArtifact, deriveTitleFromText, normalizeTextBody, } from './base.js';
const FIRST_MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m;
const FRONTMATTER_RE = /^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;
function stripInlineMarkdown(value) {
    return value
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .trim();
}
function extractMarkdownTitle(content, filePath, frontmatter) {
    const heading = content.match(FIRST_MARKDOWN_HEADING)?.[1];
    if (heading) {
        return stripInlineMarkdown(heading);
    }
    if (frontmatter.title) {
        return frontmatter.title;
    }
    return deriveTitleFromText(content, filePath);
}
function markdownToPlainText(content) {
    return normalizeTextBody(content)
        .split('\n')
        .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, ''))
        .map((line) => line.replace(/^>\s?/, ''))
        .map((line) => line.replace(/^\s*[-*+]\s+/, ''))
        .map((line) => line.replace(/^\s*\d+\.\s+/, ''))
        .map(stripInlineMarkdown)
        .join('\n')
        .trim();
}
export async function parseMarkdownSource(input) {
    const { body, frontmatter } = stripFrontmatter(input.content);
    const title = extractMarkdownTitle(body, input.path, frontmatter);
    return createParsedArtifact({
        kind: 'md',
        sourceId: input.sourceId,
        path: input.path,
        title,
        body: markdownToPlainText(body),
        parser: 'markdown',
        parsedAt: input.parsedAt,
        metadata: {
            ...(Object.keys(frontmatter).length > 0 ? { hasFrontmatter: true } : {}),
            ...(frontmatter.title ? { frontmatterTitle: frontmatter.title } : {}),
            ...(isSourceMapMarkdown(input.path, title, body) ? { sourceRole: 'source-map' } : {}),
        },
    });
}
export const markdownParser = {
    kind: 'md',
    parse: parseMarkdownSource,
};
function stripFrontmatter(content) {
    const match = content.match(FRONTMATTER_RE);
    if (!match) {
        return { body: content, frontmatter: {} };
    }
    return {
        body: content.slice(match[0].length),
        frontmatter: parseSimpleFrontmatter(match[1] ?? ''),
    };
}
function parseSimpleFrontmatter(frontmatter) {
    const parsed = {};
    for (const line of frontmatter.split('\n')) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
        if (!match) {
            continue;
        }
        parsed[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
    return parsed;
}
function isSourceMapMarkdown(filePath, title, body) {
    const basename = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '').toLowerCase();
    const titleLooksLikeIndex = /^(index|contents?|目录|索引)$/i.test(title.trim()) || /(?:index|contents?|目录|索引)/i.test(title.trim()) || basename === 'index';
    if (!titleLooksLikeIndex) {
        return false;
    }
    if (basename === 'index' && /(?:index|contents?|目录|索引)/i.test(title.trim())) {
        return true;
    }
    const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return true;
    }
    const navigationLines = lines.filter((line) => /^#{1,6}\s+/.test(line) || /^[-*+]\s+/.test(line) || /^\|.+\|$/.test(line) || /\[[^\]]+\]\([^)]*\)/.test(line) || /\[\[[^\]]+\]\]/.test(line) || /`[^`]+\.(?:md|markdown|txt)`/.test(line));
    return navigationLines.length / lines.length >= 0.5;
}
