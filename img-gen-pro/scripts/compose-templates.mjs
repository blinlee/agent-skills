import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import {
  normalizeText,
  extractAsciiTokens,
  containsPhrase,
} from './prompt-bridge-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const profilesFile = path.join(root, 'data', 'template-composer-profiles.json');

const DIMENSIONS = ['purpose', 'content', 'structure', 'style', 'constraints'];
const ROLE_ORDER = ['primary', 'supporting', 'style', 'constraint'];
const WEAK_TERMS = new Set(['用户', '清晰', '可读', '任务', '系统', '结构', '风格', '要求', '内容', '展示', 'user', 'clear', 'readable', 'task', 'system', 'structure', 'style']);

function printHelp() {
  console.log(`Usage:
  node scripts/compose-templates.mjs --query "paper figure for Claude Code harness architecture" [--json]

Options:
  --query <text>       User request
  --queryfile <path>   Load request text from a file
  --json               Print structured JSON output
  -h, --help           Show help`);
}

function parseArgs(argv) {
  const cfg = { query: null, queryFile: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--query') cfg.query = argv[++i] || null;
    else if (arg === '--queryfile') cfg.queryFile = argv[++i] || null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

async function readQuery(cfg) {
  if (cfg.query) return String(cfg.query).trim();
  if (cfg.queryFile) return (await readFile(path.resolve(cfg.queryFile), 'utf8')).trim();
  throw new Error('Query is required. Use --query or --queryfile.');
}

async function loadProfiles() {
  return JSON.parse(await readFile(profilesFile, 'utf8'));
}

function tokenizeForComposer(text) {
  const ascii = extractAsciiTokens(text).filter((token) => !WEAK_TERMS.has(token));
  const han = [...String(text || '').matchAll(/[\p{Script=Han}]{2,}/gu)].map((m) => m[0]).filter((term) => !WEAK_TERMS.has(term));
  return new Set([...ascii, ...han.map((item) => normalizeText(item))]);
}

function isAsciiTerm(value) {
  return /^[a-z0-9][a-z0-9+\-\s]*$/i.test(String(value || '').trim());
}

function termMatches(query, queryTokens, term) {
  const raw = String(term || '').trim();
  const normalized = normalizeText(term);
  if (!normalized || WEAK_TERMS.has(normalized) || WEAK_TERMS.has(term)) return false;
  if (queryTokens.has(normalized)) return true;

  if (isAsciiTerm(raw)) {
    // ASCII terms must respect token boundaries. This prevents acronym/short-token
    // substring pollution such as AP→infographic or CHI→architecture.
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(normalizeText(query));
  }

  return containsPhrase(query, term);
}

function scoreTerms(query, queryTokens, terms = [], pointsPerTerm = 8, cap = 32, reason) {
  const hits = [];
  for (const term of terms || []) {
    if (termMatches(query, queryTokens, term)) hits.push(term);
  }
  const uniqueHits = [...new Set(hits)];
  const points = Math.min(cap, uniqueHits.length * pointsPerTerm);
  return points ? { points, hits: uniqueHits, reason } : null;
}

function inferIntent(query, queryTokens) {
  const buckets = {
    purpose: [],
    content: [],
    structure: [],
    style: [],
    constraints: [],
  };
  const rules = [
    ['purpose', 'paper-figure', ['论文', '学术', '期刊', '顶刊', 'paper', 'publication', 'CHI', 'Nature', 'Science']],
    ['purpose', 'financial-report', ['A股', '行情', '指数', '板块', '券商', '研报', '策略', '市场快照', 'market snapshot']],
    ['purpose', 'ui-mockup', ['UI', '界面', 'app', 'dashboard', 'screenshot', '直播', '弹幕']],
    ['purpose', 'commerce', ['商品', '产品主图', '电商', '落地页', 'cta', 'buy now', '转化']],
    ['purpose', 'image-edit', ['参考图', '两张图', '换背景', '融合', '合成', '放进']],
    ['content', 'system-architecture', ['架构', '架构图', '系统架构', 'harness', 'runtime', 'sandbox', 'agent', '微服务', 'api gateway']],
    ['content', 'market-data', ['A股', '沪深', '创业板', '科创', '指数', '板块', '成交额']],
    ['content', 'product', ['产品', '商品', '夹克', 'serum', 'bottle', 'skincare']],
    ['structure', 'architecture-diagram', ['架构图', 'architecture diagram', 'component', 'boundary', 'control flow', '流程', '箭头']],
    ['structure', 'report-page', ['报告', '研报', '早报', '策略', '快照', 'dashboard', '数据卡']],
    ['structure', 'bento-grid', ['bento', '模块', '卡片', '信息图', 'explainer']],
    ['structure', 'ui-screen', ['界面', '屏幕', '按钮', '评论区', '商品卡', 'screen']],
    ['style', 'academic', ['Nature', 'Science', 'CHI', '论文', '学术', '白底', '矢量', 'publication']],
    ['style', 'financial-research', ['券商', '研报', '金融', '策略', 'research desk']],
    ['style', 'commercial', ['商业', '高级感', '广告', 'campaign', 'premium']],
    ['constraints', 'readable-labels', ['可读', '清晰', '标签', '文字', 'readable', 'label']],
    ['constraints', 'no-logo', ['不要logo', '无logo', 'no logo', 'no watermark']],
    ['constraints', 'aspect-16-9', ['16:9', '横版']],
    ['constraints', 'exact-text', ['写上', '写在', '文字', 'exact text']],
  ];
  for (const [dimension, value, terms] of rules) {
    if (terms.some((term) => termMatches(query, queryTokens, term))) buckets[dimension].push(value);
  }
  return Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, [...new Set(values)]]));
}

function scoreProfile(query, queryTokens, profile) {
  const dimensionScores = {};
  const evidence = [];
  for (const dimension of DIMENSIONS) {
    const result = scoreTerms(query, queryTokens, profile[dimension] || [], 12, 36, dimension);
    dimensionScores[dimension] = result?.points || 0;
    if (result) evidence.push({ dimension, points: result.points, hits: result.hits });
  }
  const positives = scoreTerms(query, queryTokens, profile.positiveTerms || [], 14, 56, 'positiveTerms');
  if (positives) evidence.push({ dimension: 'positiveTerms', points: positives.points, hits: positives.hits });

  if (profile.fallbackOnly && !evidence.length) {
    return {
      target: profile.target,
      roles: profile.roles || [],
      score: 0,
      roleScores: { primary: 0, supporting: 0, style: 0, constraint: 0 },
      assignedRole: (profile.roles || [])[0] || 'supporting',
      dimensionScores,
      evidence,
      negativeFor: profile.negativeFor || [],
    };
  }

  const roleBonus = (profile.roles || []).includes('primary') ? 8 : 0;
  const primaryScore = (dimensionScores.purpose * 1.4) + (dimensionScores.content * 1.6) + (dimensionScores.structure * 1.5) + (dimensionScores.style * 0.6) + (positives?.points || 0) + roleBonus;
  const supportingScore = (dimensionScores.content * 1.2) + (dimensionScores.structure * 1.1) + (dimensionScores.purpose * 0.8) + (positives?.points || 0) * 0.7;
  const styleScore = (dimensionScores.style * 1.8) + (dimensionScores.purpose * 0.5) + (positives?.points || 0) * 0.5;
  const constraintScore = (dimensionScores.constraints * 2) + (positives?.points || 0) * 0.3;

  const roleScores = { primary: primaryScore, supporting: supportingScore, style: styleScore, constraint: constraintScore };
  const evidenceHitCount = evidence.reduce((sum, item) => sum + (item.hits?.length || 0), 0);
  const specificityBonus = Math.min(12, Math.max(0, evidenceHitCount - 1) * 2);
  for (const role of Object.keys(roleScores)) roleScores[role] += specificityBonus;
  let bestRole = 'supporting';
  for (const role of ROLE_ORDER) {
    if ((profile.roles || []).includes(role) && roleScores[role] > roleScores[bestRole]) bestRole = role;
  }
  if (!(profile.roles || []).includes(bestRole)) {
    bestRole = [...(profile.roles || [])].sort((a, b) => (roleScores[b] || 0) - (roleScores[a] || 0))[0] || 'supporting';
  }

  return {
    target: profile.target,
    roles: profile.roles || [],
    score: Math.round((roleScores[bestRole] || 0) * 10) / 10,
    roleScores: Object.fromEntries(Object.entries(roleScores).map(([key, value]) => [key, Math.round(value * 10) / 10])),
    assignedRole: bestRole,
    dimensionScores,
    evidence,
    negativeFor: profile.negativeFor || [],
  };
}

function conflictsWithPrimary(item, primary) {
  if (!primary || item.target === primary.target) return false;
  const primaryNegative = new Set(primary.negativeFor || []);
  const itemNegative = new Set(item.negativeFor || []);
  return [...primaryNegative].some((tag) => itemNegative.has(tag)) || [...itemNegative].some((tag) => primaryNegative.has(tag));
}

function buildCompositionPlan(scored) {
  const positive = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));
  const primary = positive.filter((item) => item.roles.includes('primary')).sort((a, b) => b.roleScores.primary - a.roleScores.primary)[0] || positive[0] || null;
  const compatible = positive.filter((item) => !conflictsWithPrimary(item, primary));
  const rejected = positive
    .filter((item) => conflictsWithPrimary(item, primary))
    .map((item) => ({ target: item.target, reason: `negative profile conflict with primary ${primary.target}` }));
  const supporting = compatible
    .filter((item) => item.target !== primary?.target && item.score >= 18 && (item.roles.includes('supporting') || item.assignedRole === 'supporting'))
    .slice(0, 3);
  const style = compatible
    .filter((item) => item.target !== primary?.target && item.score >= 14 && item.roles.includes('style'))
    .slice(0, 2);
  const constraints = [...new Set(compatible.flatMap((item) => (item.evidence || []).filter((e) => e.dimension === 'constraints').flatMap((e) => e.hits)))];
  return { primary, supporting, style, constraints, rejected, candidates: positive.slice(0, 8) };
}

function printHuman(result) {
  console.log('# Template Composition\n');
  console.log(`Query: ${result.query}\n`);
  console.log('## Intent');
  for (const [key, values] of Object.entries(result.intent)) console.log(`- ${key}: ${values.join(', ') || 'none'}`);
  console.log('\n## Composition Plan');
  console.log(`- primary: ${result.compositionPlan.primary?.target || 'none'}`);
  console.log(`- supporting: ${(result.compositionPlan.supporting || []).map((i) => i.target).join(', ') || 'none'}`);
  console.log(`- style: ${(result.compositionPlan.style || []).map((i) => i.target).join(', ') || 'none'}`);
  console.log(`- constraints: ${(result.compositionPlan.constraints || []).join(', ') || 'none'}`);
  console.log('\n## Top Candidates');
  for (const item of result.compositionPlan.candidates || []) {
    console.log(`- ${item.target} [${item.assignedRole}] score ${item.score}`);
    for (const e of item.evidence.slice(0, 4)) console.log(`  - +${e.points} ${e.dimension}: ${e.hits.join(', ')}`);
  }
}

export async function composeTemplatesForQuery(query) {
  const profiles = await loadProfiles();
  const queryTokens = tokenizeForComposer(query);
  const intent = inferIntent(query, queryTokens);
  const scored = (profiles.profiles || []).map((profile) => scoreProfile(query, queryTokens, profile));
  const compositionPlan = buildCompositionPlan(scored);
  return { query, intent, compositionPlan, source: profilesFile };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) return printHelp();
  const query = await readQuery(cfg);
  const result = await composeTemplatesForQuery(query);
  if (cfg.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
