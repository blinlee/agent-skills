const STOP_WORDS = new Set([
    'what', 'which', 'when', 'where', 'who', 'why', 'how', 'is', 'are', 'was', 'were', 'the', 'a', 'an',
    'for', 'to', 'of', 'and', 'or', 'in', 'on', 'from', 'with', 'about', 'summarize', 'summary', 'new',
    'does', 'did', 'do', 'this', 'that', 'these', 'those', 'into', 'onto', 'than', 'then', 'has', 'have',
    'had', 'been', 'current', 'wiki', 'tell', 'give', 'show', 'explain', 'say', 'says', 'present', 'not',
    'topic', 'topics',
]);
const ASCII_TOKEN_PATTERN = /[a-z0-9]+/g;
export function tokenize(value) {
    return value
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .flatMap(extractSearchTokens)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}
function extractSearchTokens(token) {
    const asciiTokens = token.match(ASCII_TOKEN_PATTERN) ?? [];
    if (asciiTokens.length === 0) {
        return [token];
    }
    const tokens = [...asciiTokens];
    const stripped = token.replace(ASCII_TOKEN_PATTERN, ' ').trim();
    if (stripped && stripped.length !== token.length) {
        tokens.push(stripped);
    }
    return tokens;
}
export function tokenCounts(value) {
    const counts = {};
    for (const token of tokenize(value)) {
        counts[token] = (counts[token] ?? 0) + 1;
    }
    return counts;
}
export function approximateTokenCount(value) {
    return Math.max(1, tokenize(value).length);
}
