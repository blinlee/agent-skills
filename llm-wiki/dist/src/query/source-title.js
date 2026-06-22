import path from 'node:path';
export function displaySourceTitle(input) {
    const title = input.title.trim();
    if (title && !isBoilerplateTitle(title)) {
        return title;
    }
    return (titleFromPathLike(input.sourceRef)
        ?? titleFromPathLike(input.rawPath)
        ?? titleFromPathLike(input.filePath)
        ?? title)
        || 'Untitled source';
}
function isBoilerplateTitle(title) {
    const normalized = title.trim().replace(/\s+/g, ' ');
    const lower = normalized.toLowerCase();
    if ([
        'open access',
        'advances',
        'abstract',
        'introduction',
        'contents',
        'front matter',
        'arxiv',
        'research article',
    ].includes(lower)) {
        return true;
    }
    const letters = normalized.replace(/[^A-Za-z]/g, '');
    const words = normalized.split(/\s+/).filter(Boolean);
    return words.length <= 3
        && letters.length >= 4
        && letters === letters.toUpperCase();
}
function titleFromPathLike(value) {
    if (!value) {
        return null;
    }
    const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
    const basename = path.basename(withoutQuery).replace(/\.(md|markdown|txt|pdf|html?|docx?|pptx?)$/i, '');
    const cleaned = basename
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || isBoilerplateTitle(cleaned)) {
        return null;
    }
    return cleaned
        .split(' ')
        .map(formatTitleWord)
        .join(' ');
}
function formatTitleWord(word) {
    const lower = word.toLowerCase();
    const acronyms = {
        ai: 'AI',
        api: 'API',
        arxiv: 'arXiv',
        bm25: 'BM25',
        graphrag: 'GraphRAG',
        html: 'HTML',
        hyde: 'HyDE',
        json: 'JSON',
        lightrag: 'LightRAG',
        llm: 'LLM',
        pdf: 'PDF',
        rag: 'RAG',
        sql: 'SQL',
    };
    return acronyms[lower] ?? word.charAt(0).toUpperCase() + word.slice(1);
}
