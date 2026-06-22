export function evidenceBudgetForChunkCount(chunkCount, citationLimitOverride) {
    const normalizedChunkCount = Math.max(0, Math.floor(chunkCount));
    const base = baseBudgetForChunkCount(normalizedChunkCount);
    return {
        ...base,
        citationLimit: normalizeCitationLimit(citationLimitOverride) ?? base.citationLimit,
    };
}
function baseBudgetForChunkCount(chunkCount) {
    if (chunkCount < 100) {
        return { chunkCount, citationLimit: 4, contextCharCap: 6000 };
    }
    if (chunkCount <= 500) {
        return { chunkCount, citationLimit: 6, contextCharCap: 12000 };
    }
    if (chunkCount <= 2000) {
        return { chunkCount, citationLimit: 8, contextCharCap: 20000 };
    }
    if (chunkCount <= 5000) {
        return { chunkCount, citationLimit: 10, contextCharCap: 30000 };
    }
    return { chunkCount, citationLimit: 12, contextCharCap: 40000 };
}
function normalizeCitationLimit(value) {
    if (value === undefined || !Number.isFinite(value)) {
        return null;
    }
    return Math.max(1, Math.floor(value));
}
