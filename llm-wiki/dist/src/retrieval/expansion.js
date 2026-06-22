import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hostLocalConfigPaths } from './embedding-config.js';
const DEFAULT_EXPANSION_TIMEOUT_MS = 30_000;
const DEFAULT_EXPANSION_COUNT = 3;
const DEFAULT_EXPANSION_PROMPT_TEMPLATE = 'Generate {count} diverse search queries for: {question}\nUse synonyms, broader/narrower wording, and related technical terms. Return one query per line.';
const RRF_K = 60;
const ORIGINAL_QUERY_WEIGHT = 1;
const EXPANDED_QUERY_WEIGHT = 0.7;
export function loadQueryExpansionConfigFromEnv(env = process.env) {
    const fileConfig = readHostLocalExpansionConfig(env);
    if (fileConfig?.enabled === false && !readEnv(env, 'LLM_WIKI_EXPANSION_ENDPOINT')) {
        return null;
    }
    const endpoint = readEnv(env, 'LLM_WIKI_EXPANSION_ENDPOINT') ?? normalizedString(fileConfig?.endpoint);
    if (!endpoint) {
        return null;
    }
    return {
        endpoint,
        model: readEnv(env, 'LLM_WIKI_EXPANSION_MODEL') ?? normalizedString(fileConfig?.model),
        timeoutMs: parsePositiveInteger(readEnv(env, 'LLM_WIKI_EXPANSION_TIMEOUT_MS') ?? fileConfig?.timeoutMs, DEFAULT_EXPANSION_TIMEOUT_MS, 'LLM_WIKI_EXPANSION_TIMEOUT_MS'),
        count: parsePositiveInteger(readEnv(env, 'LLM_WIKI_EXPANSION_COUNT') ?? fileConfig?.count, DEFAULT_EXPANSION_COUNT, 'LLM_WIKI_EXPANSION_COUNT'),
        promptTemplate: readEnv(env, 'LLM_WIKI_EXPANSION_PROMPT_TEMPLATE')
            ?? readEnv(env, 'LLM_WIKI_EXPANSION_PROMPT')
            ?? normalizedString(fileConfig?.promptTemplate)
            ?? normalizedString(fileConfig?.prompt)
            ?? DEFAULT_EXPANSION_PROMPT_TEMPLATE,
    };
}
export async function generateQueryExpansions(input) {
    const config = input.config === undefined ? loadQueryExpansionConfigFromEnv() : input.config;
    if (!config) {
        return domainSynonymExpansions(input);
    }
    const generator = input.generator ?? new LocalHttpQueryExpansionGenerator();
    try {
        const queries = normalizeQueries(await generator.generate({ question: input.question, config }), input.question, config.count);
        if (queries.length === 0) {
            input.diagnostics.push('query expansion endpoint returned no usable queries');
            return domainSynonymExpansions(input, config.count);
        }
        input.diagnostics.push(`query expansion generated ${queries.length} query variant(s)`);
        return queries;
    }
    catch (error) {
        input.diagnostics.push(`query expansion unavailable; using original query only: ${error.message}`);
        return domainSynonymExpansions(input, config.count);
    }
}
export function fuseLexicalScoresWithRrf(input) {
    if (input.expanded.length === 0) {
        return input.original;
    }
    const fused = new Map();
    addRankedScores(fused, input.original, input.originalWeight ?? ORIGINAL_QUERY_WEIGHT, input.k ?? RRF_K);
    for (const item of input.expanded) {
        addRankedScores(fused, item.scores, input.expansionWeight ?? EXPANDED_QUERY_WEIGHT, input.k ?? RRF_K);
    }
    return new Map([...fused.entries()]
        .map(([chunkId, value]) => [chunkId, {
            score: Number(value.score.toFixed(9)),
            terms: [...value.terms].sort(),
        }])
        .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0])));
}
export class LocalHttpQueryExpansionGenerator {
    async generate(input) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
        try {
            const prompt = renderPrompt(input.config.promptTemplate, input.question, input.config.count);
            const response = await fetch(input.config.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    model: input.config.model ?? undefined,
                    question: input.question,
                    count: input.config.count,
                    prompt,
                    messages: [{ role: 'user', content: prompt }],
                }),
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
            }
            let body;
            try {
                body = JSON.parse(text);
            }
            catch {
                throw new Error(`Query expansion endpoint returned non-JSON response: ${text.slice(0, 120)}`);
            }
            return parseExpansionResponse(body);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`Query expansion endpoint timed out after ${input.config.timeoutMs}ms: ${input.config.endpoint}`);
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
function addRankedScores(target, scores, weight, k) {
    const ranked = [...scores.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]));
    ranked.forEach(([chunkId, score], rank) => {
        const current = target.get(chunkId) ?? { score: 0, terms: new Set() };
        current.score += weight * (1 / (k + rank));
        for (const term of score.terms) {
            current.terms.add(term);
        }
        target.set(chunkId, current);
    });
}
function parseExpansionResponse(body) {
    if (typeof body === 'string') {
        return splitQueryText(body);
    }
    if (Array.isArray(body)) {
        return body.filter((item) => typeof item === 'string');
    }
    if (!isRecord(body)) {
        throw new Error('Query expansion endpoint returned a non-object JSON response.');
    }
    const array = arrayField(body, 'queries')
        ?? arrayField(body, 'query_expansions')
        ?? arrayField(body, 'queryExpansions')
        ?? arrayField(body, 'rewrites');
    if (array) {
        return array;
    }
    const direct = stringField(body, 'text')
        ?? stringField(body, 'answer')
        ?? stringField(body, 'response')
        ?? stringField(body, 'generated_text');
    if (direct) {
        return splitQueryText(direct);
    }
    const choices = body.choices;
    if (Array.isArray(choices) && isRecord(choices[0])) {
        const first = choices[0];
        const text = stringField(first, 'text');
        if (text) {
            return splitQueryText(text);
        }
        if (isRecord(first.message)) {
            const content = stringField(first.message, 'content');
            if (content) {
                return splitQueryText(content);
            }
        }
    }
    throw new Error('Query expansion endpoint response missing generated queries.');
}
function normalizeQueries(queries, originalQuestion, count) {
    const original = normalizeQuery(originalQuestion);
    const seen = new Set();
    const result = [];
    for (const query of queries) {
        const normalized = normalizeQuery(query);
        if (!normalized || normalized === original || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
        if (result.length >= count) {
            break;
        }
    }
    return result;
}
function splitQueryText(value) {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}
function normalizeQuery(value) {
    return value
        .trim()
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/\s+/g, ' ');
}
function readHostLocalExpansionConfig(env) {
    for (const configPath of hostLocalConfigPaths(env)) {
        const data = readJsonConfig(configPath);
        if (!data)
            continue;
        const config = data.queryExpansionProvider ?? data.queryExpansion ?? data.expansionProvider ?? data.expansion;
        if (config && typeof config === 'object') {
            return config;
        }
    }
    return null;
}
function domainSynonymExpansions(input, count = DEFAULT_EXPANSION_COUNT) {
    if (!input.knowledgeRoot) {
        return [];
    }
    const synonyms = readDomainSynonyms(input.knowledgeRoot);
    if (Object.keys(synonyms).length === 0) {
        return [];
    }
    const question = normalizeQuery(input.question);
    const lowerQuestion = question.toLowerCase();
    const generated = [];
    for (const [term, values] of Object.entries(synonyms)) {
        const normalizedTerm = normalizeQuery(term);
        if (!normalizedTerm || !containsTerm(lowerQuestion, normalizedTerm.toLowerCase())) {
            continue;
        }
        for (const value of values) {
            const normalizedValue = normalizeQuery(value);
            if (!normalizedValue)
                continue;
            generated.push(replaceTerm(question, normalizedTerm, normalizedValue));
            if (generated.length >= count)
                break;
        }
        if (generated.length >= count)
            break;
    }
    const result = normalizeQueries(generated, input.question, count);
    if (result.length > 0) {
        input.diagnostics.push(`query expansion used ${result.length} domain synonym variant(s)`);
    }
    return result;
}
function readDomainSynonyms(knowledgeRoot) {
    const filePath = path.join(path.resolve(knowledgeRoot), 'system', 'index', 'domain-synonyms.json');
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        if (isRecord(parsed) && isRecord(parsed.synonyms)) {
            return normalizeSynonymRecord(parsed.synonyms);
        }
        return isRecord(parsed) ? normalizeSynonymRecord(parsed) : {};
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return {};
        throw error;
    }
}
function normalizeSynonymRecord(value) {
    return Object.fromEntries(Object.entries(value).flatMap(([term, synonyms]) => {
        if (!Array.isArray(synonyms))
            return [];
        const values = synonyms.filter((item) => typeof item === 'string' && item.trim().length > 0);
        return values.length > 0 ? [[term, values]] : [];
    }));
}
function containsTerm(question, term) {
    if (/^[a-z0-9 ]+$/i.test(term)) {
        return new RegExp(`(^|\\s)${escapeRegExp(term)}(\\s|$)`, 'i').test(question);
    }
    return question.includes(term);
}
function replaceTerm(question, term, replacement) {
    if (/^[a-z0-9 ]+$/i.test(term)) {
        return question.replace(new RegExp(`(^|\\s)${escapeRegExp(term)}(?=\\s|$)`, 'i'), (match, prefix) => `${prefix}${replacement}`);
    }
    return question.replace(term, replacement);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
function renderPrompt(template, question, count) {
    const rendered = template.replaceAll('{question}', question).replaceAll('{count}', String(count));
    return rendered === template ? `${template}\n\nQuestion: ${question}\nCount: ${count}` : rendered;
}
function parsePositiveInteger(value, fallback, name) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid ${name}: ${value}. Must be a positive integer.`);
    }
    return parsed;
}
function readEnv(env, name) {
    const upper = env[name];
    const lower = env[name.toLowerCase()];
    const value = upper && upper.trim().length > 0 ? upper : lower;
    return value && value.trim().length > 0 ? value.trim() : null;
}
function normalizedString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function stringField(value, key) {
    const item = value[key];
    return typeof item === 'string' && item.trim().length > 0 ? item : null;
}
function arrayField(value, key) {
    const item = value[key];
    return Array.isArray(item) && item.every((entry) => typeof entry === 'string') ? item : null;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
