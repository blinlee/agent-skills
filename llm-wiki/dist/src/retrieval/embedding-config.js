import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export function loadEmbeddingProviderConfig(env = process.env) {
    const config = readHostLocalEmbeddingConfig(env);
    if (!config?.embedding.endpoint || !config.embedding.model) {
        return null;
    }
    const provider = normalizeProviderName(config.embedding.provider ?? 'local-http');
    const dimensions = parseOptionalPositiveInteger(config.embedding.dimensions, 'embeddingProvider.dimensions');
    const timeoutMs = parseOptionalPositiveInteger(config.embedding.timeoutMs, 'embeddingProvider.timeoutMs') ?? 30_000;
    const format = config.embedding.format ? parseFormat(config.embedding.format) : defaultFormatForProvider(provider, config.embedding.endpoint);
    return {
        provider,
        endpoint: config.embedding.endpoint,
        model: config.embedding.model,
        dimensions,
        timeoutMs,
        format,
        source: 'config',
        configPath: config.configPath,
    };
}
export function hostLocalConfigPaths(env = process.env) {
    const paths = [];
    const override = env.llm_wiki_config;
    if (override)
        return [path.resolve(expandHome(override))];
    if (process.platform === 'win32') {
        const appData = env.APPDATA;
        if (appData)
            paths.push(path.join(appData, 'llm-wiki', 'config.json'));
    }
    else {
        paths.push(path.join(os.homedir(), '.config', 'llm-wiki', 'config.json'));
    }
    if (env.XDG_CONFIG_HOME) {
        paths.push(path.join(expandHome(env.XDG_CONFIG_HOME), 'llm-wiki', 'config.json'));
    }
    if (process.platform === 'darwin') {
        paths.push(path.join(os.homedir(), 'Library', 'Application Support', 'llm-wiki', 'config.json'));
    }
    return [...new Set(paths)];
}
export function normalizeProviderName(value) {
    if (value === 'local-http' || value === 'ollama' || value === 'lm-studio' || value === 'custom-endpoint') {
        return value;
    }
    throw new Error(`Unsupported LLM_WIKI_EMBEDDING_PROVIDER: ${value}. Supported providers: local-http, ollama, lm-studio, custom-endpoint.`);
}
export function parseFormat(value) {
    if (value === 'ollama-embed' || value === 'ollama-embeddings' || value === 'openai-compatible') {
        return value;
    }
    throw new Error(`Unsupported LLM_WIKI_EMBEDDING_FORMAT: ${value}`);
}
export function defaultFormatForProvider(provider, endpoint) {
    if (provider === 'lm-studio') {
        return 'openai-compatible';
    }
    if (provider === 'ollama') {
        return inferFormat(endpoint);
    }
    return undefined;
}
export function inferFormat(endpoint) {
    const pathname = new URL(endpoint).pathname;
    if (pathname.endsWith('/api/embed')) {
        return 'ollama-embed';
    }
    if (pathname.endsWith('/api/embeddings')) {
        return 'ollama-embeddings';
    }
    if (pathname.endsWith('/v1/embeddings')) {
        return 'openai-compatible';
    }
    throw new Error(`Cannot infer embedding response format from endpoint: ${endpoint}. Set LLM_WIKI_EMBEDDING_FORMAT to ollama-embed, ollama-embeddings, or openai-compatible.`);
}
function readHostLocalEmbeddingConfig(env) {
    for (const configPath of hostLocalConfigPaths(env)) {
        const data = readJsonConfig(configPath);
        if (!data)
            continue;
        const embedding = data.embeddingProvider ?? data.embedding;
        if (embedding && typeof embedding === 'object') {
            return { embedding, configPath };
        }
    }
    return null;
}
function readJsonConfig(configPath) {
    try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
        return isRecord(parsed) ? parsed : null;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
function parseOptionalPositiveInteger(value, envName) {
    if (value === undefined)
        return undefined;
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error(`Invalid ${envName}: ${value}. Must be a positive integer.`);
    }
    return number;
}
function expandHome(value) {
    return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
