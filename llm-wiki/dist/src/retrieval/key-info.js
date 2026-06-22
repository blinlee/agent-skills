import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile } from '../shared/fs.js';
import { hostLocalConfigPaths } from './embedding-config.js';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_INPUT_CHARS = 12_000;
const DEFAULT_LANGUAGE = '中文';
const DEFAULT_PROMPT_TEMPLATE = [
    '你是一位严谨的知识提取助手。请从以下文档提取结构化信息，只返回 JSON。',
    '',
    '字段要求：',
    '- summary: 一句话核心结论（不超过100字）',
    '- key_claims: 本文档提出的关键主张或发现（数组，每项不超过200字）',
    '- methodology: 使用的技术方法、算法、实验设计（数组）',
    '- evidence: 支撑上述主张的数据、实验结果或引用（数组）',
    '- limitations: 文中明确提到的局限或边界条件（数组，无则 []）',
    '- relations: 与参考文献、前置工作或 wiki 内其他文档的关联（数组）',
    '- open_questions: 文中提到但未解决的问题（数组，无则 []）',
    '',
    '硬约束：不编造信息；不确定的字段填 []；输出严格 JSON；语言使用 {language}。',
    '',
    'Title: {title}',
    'Page: {pageTarget}',
    '',
    'Input text:',
    '```',
    '{inputText}',
    '```',
].join('\n');
export function keyInfoIndexPath(knowledgeRoot) {
    return path.join(path.resolve(knowledgeRoot), 'system', 'index', 'key-info.json');
}
export function loadKeyInfoExtractionConfigFromEnv(env = process.env) {
    const fileConfig = readHostLocalKeyInfoConfig(env);
    if (fileConfig?.enabled === false && !readEnv(env, 'LLM_WIKI_KEY_INFO_ENDPOINT')) {
        return null;
    }
    const endpoint = readEnv(env, 'LLM_WIKI_KEY_INFO_ENDPOINT') ?? normalizedString(fileConfig?.endpoint);
    if (!endpoint) {
        return null;
    }
    return {
        endpoint,
        model: readEnv(env, 'LLM_WIKI_KEY_INFO_MODEL') ?? normalizedString(fileConfig?.model),
        timeoutMs: parsePositiveInteger(readEnv(env, 'LLM_WIKI_KEY_INFO_TIMEOUT_MS') ?? fileConfig?.timeoutMs, DEFAULT_TIMEOUT_MS),
        maxInputChars: parsePositiveInteger(readEnv(env, 'LLM_WIKI_KEY_INFO_MAX_INPUT_CHARS') ?? fileConfig?.maxInputChars, DEFAULT_MAX_INPUT_CHARS),
        language: readEnv(env, 'LLM_WIKI_KEY_INFO_LANGUAGE') ?? normalizedString(fileConfig?.language) ?? DEFAULT_LANGUAGE,
        promptTemplate: readEnv(env, 'LLM_WIKI_KEY_INFO_PROMPT_TEMPLATE')
            ?? readEnv(env, 'LLM_WIKI_KEY_INFO_PROMPT')
            ?? normalizedString(fileConfig?.promptTemplate)
            ?? normalizedString(fileConfig?.prompt)
            ?? DEFAULT_PROMPT_TEMPLATE,
    };
}
export async function runKeyInfoExtraction(input) {
    const filePath = keyInfoIndexPath(input.knowledgeRoot);
    const config = input.config === undefined ? loadKeyInfoExtractionConfigFromEnv() : input.config;
    if (!config) {
        return { status: 'skipped', reason: 'key_info extraction provider not configured', filePath };
    }
    const generator = input.generator ?? new LocalHttpKeyInfoGenerator();
    const extracted = await generator.extract({
        artifact: input.artifact,
        pageTarget: input.pageTarget,
        config,
    });
    const record = normalizeExtractionRecord({
        artifact: input.artifact,
        pageTarget: input.pageTarget,
        pageTitle: input.pageTitle,
        sourceIdentity: input.sourceIdentity,
        sourceKind: input.sourceKind,
        provider: 'local-http',
        model: config.model,
        extractedAt: input.now ?? new Date().toISOString(),
        extracted,
    });
    await upsertKeyInfoRecord(input.knowledgeRoot, record);
    return { status: 'extracted', record, filePath };
}
export async function loadKeyInfoIndex(knowledgeRoot) {
    const raw = await readJsonFile(keyInfoIndexPath(knowledgeRoot), null);
    return parseKeyInfoIndex(raw);
}
export function parseKeyInfoIndex(raw) {
    if (!raw || typeof raw !== 'object') {
        return emptyKeyInfoIndex();
    }
    const record = raw;
    const rows = Array.isArray(record.records)
        ? record.records
        : Array.isArray(record.keyInfo)
            ? record.keyInfo
            : [];
    return {
        version: 1,
        schema: 'llm-wiki.key-info.v1',
        records: rows.flatMap(parseKeyInfoRecord),
    };
}
export async function upsertKeyInfoRecord(knowledgeRoot, record) {
    const existing = await loadKeyInfoIndex(knowledgeRoot);
    const records = [
        ...existing.records.filter((item) => item.pageTarget !== record.pageTarget),
        record,
    ].sort((left, right) => left.pageTarget.localeCompare(right.pageTarget));
    const next = {
        version: 1,
        schema: 'llm-wiki.key-info.v1',
        records,
    };
    await mkdir(path.dirname(keyInfoIndexPath(knowledgeRoot)), { recursive: true });
    await writeFile(keyInfoIndexPath(knowledgeRoot), JSON.stringify(next, null, 2), 'utf8');
    return next;
}
export class LocalHttpKeyInfoGenerator {
    async extract(input) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
        try {
            const prompt = renderPrompt(input.config.promptTemplate, input);
            const response = await fetch(input.config.endpoint, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    model: input.config.model ?? undefined,
                    title: input.artifact.title,
                    pageTarget: input.pageTarget,
                    language: input.config.language,
                    prompt,
                    messages: [{ role: 'user', content: prompt }],
                }),
                signal: controller.signal,
            });
            const text = await response.text();
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
            }
            return parseKeyInfoResponse(text);
        }
        catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`Key info extraction endpoint timed out after ${input.config.timeoutMs}ms: ${input.config.endpoint}`);
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
export function supplementalKeyInfoTextsByChunkId(input) {
    const chunkIds = new Set(input.chunks.map((chunk) => chunk.chunkId));
    const texts = new Map();
    for (const record of input.records) {
        const chunkId = record.chunkId;
        if (!chunkId || !chunkIds.has(chunkId))
            continue;
        const value = [
            record.summary,
            ...record.keyClaims,
            ...record.methodology,
            ...record.evidence,
            ...record.limitations,
            ...record.relations,
            ...record.openQuestions,
        ].filter((item) => typeof item === 'string' && item.length > 0).join('\n');
        if (value) {
            texts.set(chunkId, [texts.get(chunkId), value].filter(Boolean).join('\n'));
        }
    }
    return texts;
}
export function keyInfoEvidenceText(record) {
    const lines = [];
    if (record.summary) {
        lines.push(`Summary: ${record.summary}`);
    }
    appendList(lines, 'Key claims', record.keyClaims);
    appendList(lines, 'Methodology', record.methodology);
    appendList(lines, 'Evidence', record.evidence);
    appendList(lines, 'Limitations', record.limitations);
    appendList(lines, 'Relations', record.relations);
    appendList(lines, 'Open questions', record.openQuestions);
    return lines.join('\n');
}
function parseKeyInfoRecord(raw) {
    if (!raw || typeof raw !== 'object') {
        return [];
    }
    const record = raw;
    const pageTarget = stringField(record, 'pageTarget') || stringField(record, 'page_target') || stringField(record, 'target');
    if (!pageTarget) {
        return [];
    }
    return [{
            pageTarget,
            pageTitle: stringField(record, 'pageTitle') || stringField(record, 'page_title') || stringField(record, 'title') || pageTarget,
            sourceRef: stringField(record, 'sourceRef') || stringField(record, 'source_ref') || null,
            sourceIdentity: stringField(record, 'sourceIdentity') || stringField(record, 'source_identity') || null,
            sourceKind: isSourceKind(record.sourceKind ?? record.source_kind) ? record.sourceKind : 'md',
            contentSha256: stringField(record, 'contentSha256') || stringField(record, 'content_sha256'),
            extractedAt: stringField(record, 'extractedAt') || stringField(record, 'extracted_at') || new Date(0).toISOString(),
            provider: record.provider === 'local-http' ? 'local-http' : 'manual',
            model: stringField(record, 'model') || null,
            chunkId: stringField(record, 'chunkId') || stringField(record, 'chunk_id') || undefined,
            title: stringField(record, 'title') || pageTarget,
            summary: stringField(record, 'summary') || stringField(record, 'key_conclusions_summary') || undefined,
            keyClaims: stringArray(record.keyClaims ?? record.key_claims ?? record.key_conclusions),
            methodology: stringArray(record.methodology ?? record.methods ?? record.key_experimental_setup),
            evidence: stringArray(record.evidence ?? record.key_data ?? record.key_experimental_results ?? record.key_phenomena),
            limitations: stringArray(record.limitations ?? record.key_limitations),
            relations: stringArray(record.relations ?? record.key_relations),
            openQuestions: stringArray(record.openQuestions ?? record.open_questions ?? record.key_open_questions),
        }];
}
function normalizeExtractionRecord(input) {
    return {
        pageTarget: input.pageTarget,
        pageTitle: input.pageTitle,
        sourceRef: input.artifact.sourceRef,
        sourceIdentity: input.sourceIdentity,
        sourceKind: input.sourceKind,
        contentSha256: sha256(input.artifact.content),
        extractedAt: input.extractedAt,
        provider: input.provider,
        model: input.model,
        title: input.pageTitle,
        summary: input.extracted.summary,
        keyClaims: input.extracted.keyClaims,
        methodology: input.extracted.methodology,
        evidence: input.extracted.evidence,
        limitations: input.extracted.limitations,
        relations: input.extracted.relations,
        openQuestions: input.extracted.openQuestions,
    };
}
function parseKeyInfoResponse(text) {
    const parsed = parsePossiblyNestedJson(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Key info extraction endpoint returned a non-object JSON response.');
    }
    const records = parseKeyInfoRecord(parsed);
    if (records[0]) {
        return records[0];
    }
    const record = parsed;
    return {
        summary: stringField(record, 'summary') || stringField(record, 'key_conclusions_summary') || undefined,
        keyClaims: stringArray(record.keyClaims ?? record.key_claims ?? record.key_conclusions),
        methodology: stringArray(record.methodology ?? record.methods ?? record.key_experimental_setup),
        evidence: stringArray(record.evidence ?? record.key_data ?? record.key_experimental_results ?? record.key_phenomena),
        limitations: stringArray(record.limitations ?? record.key_limitations),
        relations: stringArray(record.relations ?? record.key_relations),
        openQuestions: stringArray(record.openQuestions ?? record.open_questions ?? record.key_open_questions),
    };
}
function parsePossiblyNestedJson(text) {
    const body = parseJson(stripCodeFence(text));
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        const record = body;
        const direct = stringField(record, 'text') || stringField(record, 'answer') || stringField(record, 'response') || stringField(record, 'generated_text');
        if (direct) {
            return parseJson(stripCodeFence(direct));
        }
        if (Array.isArray(record.choices) && record.choices[0] && typeof record.choices[0] === 'object') {
            const first = record.choices[0];
            const choiceText = stringField(first, 'text');
            if (choiceText) {
                return parseJson(stripCodeFence(choiceText));
            }
            if (first.message && typeof first.message === 'object') {
                const content = stringField(first.message, 'content');
                if (content) {
                    return parseJson(stripCodeFence(content));
                }
            }
        }
    }
    return body;
}
function renderPrompt(template, input) {
    return template
        .replaceAll('{title}', input.artifact.title)
        .replaceAll('{pageTarget}', input.pageTarget)
        .replaceAll('{inputText}', input.artifact.content.slice(0, input.config.maxInputChars))
        .replaceAll('{language}', input.config.language);
}
function readHostLocalKeyInfoConfig(env) {
    for (const configPath of hostLocalConfigPaths(env)) {
        const data = readJsonConfig(configPath);
        if (!data)
            continue;
        const config = data.keyInfoProvider ?? data.keyInfoExtraction;
        if (config && typeof config === 'object') {
            return config;
        }
    }
    return null;
}
function readJsonConfig(configPath) {
    try {
        const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
function parseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        throw new Error(`Key info extraction endpoint returned invalid JSON: ${value.slice(0, 160)}`);
    }
}
function stripCodeFence(value) {
    const trimmed = value.trim();
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return match?.[1]?.trim() ?? trimmed;
}
function readEnv(env, key) {
    const value = env[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function normalizedString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function parsePositiveInteger(value, fallback) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function isSourceKind(value) {
    return value === 'md' || value === 'txt' || value === 'url' || value === 'repo';
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
function appendList(lines, label, values) {
    if (values.length > 0) {
        lines.push(`${label}: ${values.join('; ')}`);
    }
}
function emptyKeyInfoIndex() {
    return { version: 1, schema: 'llm-wiki.key-info.v1', records: [] };
}
function stringField(record, key) {
    const value = record[key];
    return typeof value === 'string' ? value.trim() : '';
}
function stringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}
