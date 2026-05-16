import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.dirname(__dirname);
export const dataDir = path.join(root, 'data');
export const retrievalIndexFile = path.join(dataDir, 'retrieval-index.json');
export const caseIndexFile = path.join(dataDir, 'case-index.json');
export const promptIntelligenceIndexFile = path.join(dataDir, 'prompt-intelligence-index.json');
export const promptCorpusIndexFile = path.join(dataDir, 'prompt-corpus-index.json');

const ASCII_STOPWORDS = new Set([
  'the','and','for','with','that','this','from','into','your','have','has','are','not','but','you','use','using','used','make','made','create','design','show','want','need','over','than','then','into','onto','their','there','here','such','very','more','less','just','only','also','about','after','before','while','where','when','what','which','whose','without','within','make','made','does','done','each','per','via','its','our','out','off','all','any','can','may','should','will','would','could','render','image','reference','references','scene'
]);
const CJK_STOPGRAMS = new Set([
  '生成','一张','一个','一组','风格','风格的','包含','整体','画面','要求','输入','输出','模板','背景','主体','设计','图片','内容','结构','视觉','说明','需要','不要','使用','可以','用于','默认','参数','信息','效果','感觉','元素',
  '生成一','成一张','生成一张','设计一','计一张','设计一张','整体视','体视觉','整体视觉',
  '参考','这个','那个','这张','那张','场景'
]);

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function readIndexes() {
  const [retrievalIndex, caseIndex, promptIntelligenceIndex, promptCorpusIndex] = await Promise.all([
    readJson(retrievalIndexFile),
    readJson(caseIndexFile),
    readJson(promptIntelligenceIndexFile),
    readJson(promptCorpusIndexFile),
  ]);
  return { retrievalIndex, caseIndex, promptIntelligenceIndex, promptCorpusIndex };
}

export async function loadTemplateDocs(retrievalIndex) {
  const targets = new Set();
  for (const template of retrievalIndex.templates || []) {
    for (const target of template.canonicalTargets || []) targets.add(target);
  }
  const docs = new Map();
  await Promise.all([...targets].map(async (target) => {
    try {
      const text = await readFile(path.join(root, target), 'utf8');
      const lines = text.split(/\r?\n/);
      docs.set(target, {
        target,
        title: (lines.find((line) => line.trim().startsWith('#')) || '').replace(/^#+\s*/, '').trim(),
        snippet: text.slice(0, 1800),
        text,
      });
    } catch {
      docs.set(target, { target, title: '', snippet: '', text: '' });
    }
  }));
  return docs;
}

export function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function labelOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.en || value.zh || '';
}

export function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsPhrase(query, phrase) {
  const q = normalizeText(query);
  const p = normalizeText(phrase);
  return p.length > 1 && q.includes(p);
}

export function extractAsciiTokens(text) {
  const ascii = (normalizeText(text).match(/[a-z0-9][a-z0-9+-]*/g) || [])
    .flatMap((token) => token.split(/[+-]/g))
    .filter((token) => token.length >= 2 && !ASCII_STOPWORDS.has(token));
  const cjk = [];
  for (const run of normalizeText(text).match(/[\p{Script=Han}]{2,}/gu) || []) {
    if (run.length <= 8 && !CJK_STOPGRAMS.has(run)) cjk.push(run);
    for (const size of [2, 3, 4]) {
      if (run.length < size) continue;
      for (let i = 0; i <= run.length - size; i += 1) {
        const token = run.slice(i, i + size);
        if (!CJK_STOPGRAMS.has(token)) cjk.push(token);
      }
    }
  }
  return unique([...ascii, ...cjk]);
}

export function buildLookup(items) {
  const map = new Map();
  for (const item of items || []) map.set(item.value, item);
  return map;
}

export function cleanLine(line) {
  return String(line || '').replace(/^[-*]\s*/, '').trim();
}

export function extractNegativeBullets(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || !/不要使用|不要：|避免：/u.test(line)) continue;
    const bucket = [line];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].trim();
      if (!next) {
        if (bucket.length > 1) break;
        continue;
      }
      if (/^##\s+/.test(next)) break;
      if (/^[-*]\s+/.test(next)) bucket.push(cleanLine(next));
      else if (bucket.length > 1) break;
      else bucket.push(next);
    }
    out.push(...bucket);
  }
  return unique(out);
}

export function tokenOverlap(text, queryTokens) {
  const overlaps = extractAsciiTokens(text).filter((token) => queryTokens.has(token));
  return unique(overlaps);
}

export function matchesRoutingTerms(query, queryTokens, terms = []) {
  return (terms || []).some((term) => containsPhrase(query, term) || queryTokens.has(normalizeText(term)));
}

export function scorePhraseAndTokens({ query, queryTokens, text, phrasePoints = 0, tokenPoints = 0, cap = Infinity, reason, label }) {
  if (!text) return { score: 0, matches: [] };
  const matches = [];
  let score = 0;
  const normalizedText = normalizeText(text);
  const normalizedQuery = normalizeText(query);
  if (phrasePoints > 0 && normalizedQuery.length > 1 && normalizedText.includes(normalizedQuery)) {
    score += phrasePoints;
    matches.push({ reason, value: `${label || 'text'}: exact-query`, points: phrasePoints });
  } else if (phrasePoints > 0 && containsPhrase(query, text)) {
    score += phrasePoints;
    matches.push({ reason, value: label || String(text).slice(0, 120), points: phrasePoints });
  }
  if (tokenPoints > 0) {
    const overlaps = tokenOverlap(text, queryTokens);
    if (overlaps.length) {
      const tokenScore = Math.min(cap === Infinity ? overlaps.length * tokenPoints : cap - score, overlaps.length * tokenPoints);
      if (tokenScore > 0) {
        score += tokenScore;
        matches.push({ reason, value: `${label || 'tokens'}: ${overlaps.join(', ')}`, points: tokenScore });
      }
    }
  }
  return { score: Math.min(score, cap), matches };
}

export function buildPromptMaps(promptIntelligenceIndex, promptCorpusIndex) {
  const promptByTemplateId = new Map((promptIntelligenceIndex.templates || []).map((item) => [item.id, item]));
  const exactCasesByTemplateId = new Map();
  const candidateCasesByTemplateId = new Map();

  for (const item of promptCorpusIndex.cases || []) {
    for (const templateId of item.exactTemplateIds || []) {
      if (!exactCasesByTemplateId.has(templateId)) exactCasesByTemplateId.set(templateId, []);
      exactCasesByTemplateId.get(templateId).push(item);
    }
    for (const candidate of item.candidateTemplates || []) {
      if (!candidateCasesByTemplateId.has(candidate.id)) candidateCasesByTemplateId.set(candidate.id, []);
      candidateCasesByTemplateId.get(candidate.id).push({ ...item, candidateScore: candidate.score });
    }
  }

  for (const bucket of exactCasesByTemplateId.values()) bucket.sort((a, b) => Number(b.featured) - Number(a.featured) || a.id - b.id);
  for (const bucket of candidateCasesByTemplateId.values()) bucket.sort((a, b) => (b.candidateScore || 0) - (a.candidateScore || 0) || a.id - b.id);

  return { promptByTemplateId, exactCasesByTemplateId, candidateCasesByTemplateId };
}

export function rankPromptVariants(query, variants, limit = 3) {
  const queryTokens = new Set(extractAsciiTokens(query));
  const ranked = (variants || []).map((variant, index) => {
    let score = 0;
    const matchedOn = [];
    for (const spec of [
      { text: variant.label, phrasePoints: 14, tokenPoints: 5, cap: 18, reason: 'prompt-variant-label' },
      { text: variant.notes, phrasePoints: 8, tokenPoints: 3, cap: 12, reason: 'prompt-variant-notes' },
      { text: variant.prompt, phrasePoints: 10, tokenPoints: 2, cap: 14, reason: 'prompt-variant-prompt' },
    ]) {
      const result = scorePhraseAndTokens({ query, queryTokens, ...spec, label: variant.label });
      score += result.score;
      matchedOn.push(...result.matches);
    }
    const isSpecialized = !/常规模板|JSON 进阶模板/u.test(variant.label || '');
    return { ...variant, score, matchedOn, index, isSpecialized };
  }).sort((a, b) => b.score - a.score || Number(b.isSpecialized) - Number(a.isSpecialized) || a.index - b.index);

  const chosen = [];
  for (const item of ranked) {
    if (item.score > 0) chosen.push(item);
    if (chosen.length >= limit) return chosen.slice(0, limit);
  }

  for (const item of ranked) {
    if (chosen.includes(item)) continue;
    if (item.isSpecialized) chosen.push(item);
    if (chosen.length >= limit) return chosen.slice(0, limit);
  }

  for (const item of ranked) {
    if (chosen.includes(item)) continue;
    chosen.push(item);
    if (chosen.length >= limit) break;
  }

  return chosen.slice(0, Math.min(limit, ranked.length));
}

export function rankCasesForQuery(query, cases, limit = 3, { exact = false } = {}) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = new Set(extractAsciiTokens(query));
  const ranked = (cases || []).map((item) => {
    let score = exact ? 8 : 2;
    const matchedOn = [];
    const normalizedPreview = normalizeText(item.promptPreview);
    const normalizedPrompt = normalizeText(item.prompt);
    const normalizedTitle = normalizeText(item.title);
    if (normalizedQuery && (
      normalizedQuery === normalizedPreview ||
      normalizedQuery === normalizedPrompt ||
      normalizedQuery === normalizedTitle
    )) {
      score += exact ? 24 : 14;
      matchedOn.push({ reason: 'case-exact-query-match', value: item.title, points: exact ? 24 : 14 });
    }
    for (const spec of [
      { text: item.title, phrasePoints: 14, tokenPoints: 4, cap: 18, reason: 'case-title' },
      { text: item.promptPreview, phrasePoints: 8, tokenPoints: 2, cap: 10, reason: 'case-preview' },
      { text: item.prompt, phrasePoints: 6, tokenPoints: 1, cap: 10, reason: 'case-prompt' },
      { text: (item.styles || []).join(' '), phrasePoints: 4, tokenPoints: 2, cap: 6, reason: 'case-style' },
      { text: (item.scenes || []).join(' '), phrasePoints: 4, tokenPoints: 2, cap: 6, reason: 'case-scene' },
    ]) {
      const result = scorePhraseAndTokens({ query, queryTokens, ...spec, label: item.title });
      score += result.score;
      matchedOn.push(...result.matches);
    }
    if (!exact && item.candidateScore) {
      score += Math.min(8, item.candidateScore);
      matchedOn.push({ reason: 'case-candidate-score', value: item.title, points: Math.min(8, item.candidateScore) });
    }
    return { ...item, score, matchedOn };
  }).sort((a, b) => b.score - a.score || Number(b.featured) - Number(a.featured) || a.id - b.id);
  return ranked.slice(0, limit);
}

export function scoreTemplateTarget(query, target, doc, routing = null) {
  const queryTokens = new Set(extractAsciiTokens(query));
  let score = 0;
  const matchedOn = [];
  const addMatches = (result) => {
    score += result.score;
    matchedOn.push(...result.matches);
  };

  addMatches(scorePhraseAndTokens({
    query,
    queryTokens,
    text: path.basename(target, '.md').replace(/-/g, ' '),
    phrasePoints: 10,
    tokenPoints: 6,
    cap: 14,
    reason: 'canonical-target-path',
    label: target,
  }));

  addMatches(scorePhraseAndTokens({
    query,
    queryTokens,
    text: doc.title,
    phrasePoints: 18,
    tokenPoints: 6,
    cap: 22,
    reason: 'canonical-target-title',
    label: doc.title || target,
  }));

  addMatches(scorePhraseAndTokens({
    query,
    queryTokens,
    text: doc.snippet,
    phrasePoints: 10,
    tokenPoints: 2,
    cap: 18,
    reason: 'canonical-target-snippet',
    label: target,
  }));

  for (const negative of extractNegativeBullets(doc.text)) {
    const isRedirectiveNegative = /`[^`]+\.md`|去\s*`|用\s*`/u.test(negative);
    if (containsPhrase(query, negative)) {
      const penalty = isRedirectiveNegative ? 24 : 10;
      score -= penalty;
      matchedOn.push({ reason: 'canonical-negative-guidance', value: negative, points: -penalty });
      continue;
    }
    const overlaps = tokenOverlap(negative, queryTokens);
    if (overlaps.length) {
      const penalty = isRedirectiveNegative ? Math.min(24, overlaps.length * 5) : Math.min(8, overlaps.length * 2);
      score -= penalty;
      matchedOn.push({ reason: 'canonical-negative-guidance', value: `${negative} | ${overlaps.join(', ')}`, points: -penalty });
    }
  }

  const targetHints = routing?.targetRouteHints || [];
  const routingHint = targetHints.find((item) => {
    if (item.target === target) return true;
    if (item.matchRegex) return new RegExp(item.matchRegex).test(target);
    return false;
  });
  if (routingHint) {
    if (matchesRoutingTerms(query, queryTokens, routingHint.includeAny || [])) {
      const bonus = Math.min(24, 8 + tokenOverlap((routingHint.includeAny || []).join(' '), queryTokens).length * 4);
      score += bonus;
      matchedOn.push({ reason: 'canonical-route-hint', value: target, points: bonus });
    }
    if (matchesRoutingTerms(query, queryTokens, routingHint.excludeAny || [])) {
      const penalty = Math.min(20, 8 + tokenOverlap((routingHint.excludeAny || []).join(' '), queryTokens).length * 4);
      score -= penalty;
      matchedOn.push({ reason: 'canonical-route-mismatch', value: target, points: -penalty });
    }
  }

  return { target, score, matchedOn };
}
