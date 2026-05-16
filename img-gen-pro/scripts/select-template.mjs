import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  readIndexes,
  loadTemplateDocs,
  labelOf,
  buildLookup,
  extractAsciiTokens,
  containsPhrase,
  scorePhraseAndTokens,
  buildPromptMaps,
  rankPromptVariants,
  rankCasesForQuery,
  scoreTemplateTarget,
} from './prompt-bridge-utils.mjs';
import { loadPromptEngine, rankFragments } from './prompt-compose-utils.mjs';

function getRouting(promptEngine) {
  return promptEngine?.routing || {};
}

function getTemplateIntentProfiles(promptEngine) {
  return getRouting(promptEngine).templateIntentProfiles || {};
}

function getPairwiseClarifiers(promptEngine) {
  return getRouting(promptEngine).pairwiseClarifiers || {};
}

function getSpecialRouteBoosts(promptEngine) {
  return getRouting(promptEngine).specialRouteBoosts || [];
}

function getTemplateQueryGuards(promptEngine) {
  return getRouting(promptEngine).templateQueryGuards || {};
}

function getTemplateScoreAdjustments(promptEngine) {
  return getRouting(promptEngine).templateScoreAdjustments || [];
}

function ruleMatchesQuery(query, rule, queryTokens = null) {
  if (!rule) return false;
  const text = String(query || '');
  const tokens = queryTokens || new Set(extractAsciiTokens(text));
  const regex = rule.matchRegex ? new RegExp(rule.matchRegex, rule.matchFlags || '') : null;
  if (regex && !regex.test(text)) return false;
  if (rule.matchAny && !rule.matchAny.some((term) => containsPhrase(text, term) || tokens.has(String(term).toLowerCase()))) return false;
  if (rule.includeAny && !rule.includeAny.some((term) => containsPhrase(text, term) || tokens.has(String(term).toLowerCase()))) return false;
  if (rule.requireAny && !rule.requireAny.some((term) => containsPhrase(text, term) || tokens.has(String(term).toLowerCase()))) return false;
  if (rule.absentAny && rule.absentAny.some((term) => containsPhrase(text, term) || tokens.has(String(term).toLowerCase()))) return false;
  return true;
}

function isChineseQuery(query) {
  return /[\p{Script=Han}]/u.test(query || '');
}

function pairKey(a, b) {
  return [a, b].sort().join('__');
}

function printHelp() {
  console.log(`Usage:
  node scripts/select-template.mjs --query "make a live commerce UI mockup" [--top 3] [--json]

Options:
  --query <text>        Fuzzy user request text
  --queryfile <path>    Load fuzzy request text from a file
  --top <n>             Number of candidates to return (default: 3)
  --json                Print structured JSON output
  -h, --help            Show help`);
}

function parseArgs(argv) {
  const cfg = { query: null, queryFile: null, top: 3, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') cfg.help = true;
    else if (arg === '--json') cfg.json = true;
    else if (arg === '--query') cfg.query = argv[++i] || null;
    else if (arg === '--queryfile') cfg.queryFile = argv[++i] || null;
    else if (arg === '--top') cfg.top = Number.parseInt(argv[++i] || '3', 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return cfg;
}

async function readQuery(query, queryFile) {
  if (query) return query.trim();
  if (queryFile) return (await readFile(path.resolve(queryFile), 'utf8')).trim();
  throw new Error('Query is required. Use --query or --queryfile.');
}

function collectSignals(template, retrievalIndex, promptMaps) {
  const categoryMap = buildLookup(retrievalIndex.categories);
  const styleMap = buildLookup(retrievalIndex.styles);
  const sceneMap = buildLookup(retrievalIndex.scenes);
  return {
    category: categoryMap.get(template.category),
    styles: (template.styles || []).map((value) => styleMap.get(value)).filter(Boolean),
    scenes: (template.scenes || []).map((value) => sceneMap.get(value)).filter(Boolean),
    tags: template.tags || [],
    title: template.title,
    useWhen: template.useWhen,
    guidance: template.guidance,
    pitfalls: template.pitfalls,
    promptIntelligence: promptMaps.promptByTemplateId.get(template.id) || null,
    exactCases: promptMaps.exactCasesByTemplateId.get(template.id) || [],
    candidateCases: promptMaps.candidateCasesByTemplateId.get(template.id) || [],
  };
}

function applyTemplateGuard({ query, queryTokens, templateId, add, promptEngine }) {
  const guard = getTemplateQueryGuards(promptEngine)[templateId];
  if (!guard) return;
  const matched = (guard.requireAny || []).some((term) => containsPhrase(query, term) || queryTokens.has(term));
  if (matched && guard.boostIfMatched) add(Math.abs(guard.boostIfMatched), 'template-guard-match', templateId);
  if (!matched) add(-Math.abs(guard.penalty || 0), 'template-guard', `${templateId}: missing intent signal`);
}

function applySpecialRouteBoosts({ query, queryTokens, templateId, add, promptEngine }) {
  for (const rule of getSpecialRouteBoosts(promptEngine)) {
    if (rule.templateId === templateId && ruleMatchesQuery(query, rule, queryTokens)) {
      add(rule.points, 'special-route-boost', templateId);
    }
  }
}

function applyTemplateScoreAdjustments({ query, queryTokens, templateId, add, promptEngine }) {
  for (const rule of getTemplateScoreAdjustments(promptEngine)) {
    if (!(rule.templateIds || []).includes(templateId)) continue;
    if (!ruleMatchesQuery(query, rule, queryTokens)) continue;
    add(rule.points, rule.reason || 'template-score-adjustment', templateId);
  }
}

function scoreTemplate(query, template, retrievalIndex, templateDocs, promptMaps, promptEngine) {
  const queryTokens = new Set(extractAsciiTokens(query));
  const signals = collectSignals(template, retrievalIndex, promptMaps);
  const matchedOn = [];
  let score = 0;
  const addResult = (result) => {
    score += result.score;
    matchedOn.push(...result.matches);
  };
  const add = (points, reason, value) => {
    score += points;
    matchedOn.push({ reason, value, points });
  };

  if (signals.category) {
    addResult(scorePhraseAndTokens({ query, queryTokens, text: signals.category.value, phrasePoints: 30, tokenPoints: 6, cap: 30, reason: 'category', label: signals.category.value }));
    addResult(scorePhraseAndTokens({ query, queryTokens, text: labelOf(signals.category.title), phrasePoints: 26, tokenPoints: 5, cap: 26, reason: 'category-title', label: labelOf(signals.category.title) }));
    addResult(scorePhraseAndTokens({ query, queryTokens, text: labelOf(signals.category.description), phrasePoints: 14, tokenPoints: 2, cap: 14, reason: 'category-description', label: labelOf(signals.category.title) }));
  }

  for (const style of signals.styles) {
    addResult(scorePhraseAndTokens({ query, queryTokens, text: style.value, phrasePoints: 20, tokenPoints: 5, cap: 20, reason: 'style', label: style.value }));
    addResult(scorePhraseAndTokens({ query, queryTokens, text: labelOf(style.title), phrasePoints: 16, tokenPoints: 4, cap: 16, reason: 'style-title', label: labelOf(style.title) }));
    addResult(scorePhraseAndTokens({ query, queryTokens, text: (style.keywords || []).join(' '), phrasePoints: 10, tokenPoints: 3, cap: 12, reason: 'style-keyword', label: labelOf(style.title) }));
  }

  for (const scene of signals.scenes) {
    addResult(scorePhraseAndTokens({ query, queryTokens, text: scene.value, phrasePoints: 16, tokenPoints: 4, cap: 16, reason: 'scene', label: scene.value }));
    addResult(scorePhraseAndTokens({ query, queryTokens, text: labelOf(scene.title), phrasePoints: 14, tokenPoints: 4, cap: 14, reason: 'scene-title', label: labelOf(scene.title) }));
    addResult(scorePhraseAndTokens({ query, queryTokens, text: (scene.keywords || []).join(' '), phrasePoints: 8, tokenPoints: 3, cap: 10, reason: 'scene-keyword', label: labelOf(scene.title) }));
  }

  addResult(scorePhraseAndTokens({ query, queryTokens, text: (signals.tags || []).join(' '), phrasePoints: 10, tokenPoints: 3, cap: 12, reason: 'tag', label: template.id }));
  addResult(scorePhraseAndTokens({ query, queryTokens, text: labelOf(signals.title), phrasePoints: 14, tokenPoints: 4, cap: 14, reason: 'template-title', label: labelOf(signals.title) }));
  addResult(scorePhraseAndTokens({ query, queryTokens, text: template.id, phrasePoints: 12, tokenPoints: 5, cap: 12, reason: 'template-id', label: template.id }));
  addResult(scorePhraseAndTokens({ query, queryTokens, text: labelOf(signals.useWhen?.en || signals.useWhen?.zh || signals.useWhen), phrasePoints: 10, tokenPoints: 3, cap: 10, reason: 'use-when', label: template.id }));
  addResult(scorePhraseAndTokens({ query, queryTokens, text: [...(signals.guidance?.en || []), ...(signals.guidance?.zh || [])].join(' '), phrasePoints: 6, tokenPoints: 2, cap: 8, reason: 'guidance', label: template.id }));

  if (signals.promptIntelligence) {
    addResult(scorePhraseAndTokens({ query, queryTokens, text: signals.promptIntelligence.sectionTitle, phrasePoints: 16, tokenPoints: 4, cap: 18, reason: 'prompt-section', label: signals.promptIntelligence.sectionTitle }));
    const selectedPromptVariants = rankPromptVariants(query, signals.promptIntelligence.variants || [], 3);
    for (const variant of selectedPromptVariants) {
      add(Math.min(variant.score, 18), 'prompt-variant', `${variant.label}${variant.score ? ` (${variant.score})` : ''}`);
      for (const match of variant.matchedOn.slice(0, 3)) matchedOn.push(match);
    }
  }

  applyTemplateScoreAdjustments({ query, queryTokens, templateId: template.id, add, promptEngine });

  const exactCaseHits = rankCasesForQuery(query, signals.exactCases, 3, { exact: true });
  const candidateCaseHits = rankCasesForQuery(query, signals.candidateCases, 2, { exact: false });
  for (const item of exactCaseHits) {
    add(Math.min(item.score, 18), 'exact-case', `case ${item.id}: ${item.title}`);
    for (const match of item.matchedOn.slice(0, 3)) matchedOn.push(match);
  }
  for (const item of candidateCaseHits) {
    add(Math.min(item.score, 6), 'candidate-case', `case ${item.id}: ${item.title}`);
    for (const match of item.matchedOn.slice(0, 2)) matchedOn.push(match);
  }

  const fragments = promptEngine ? rankFragments(query, template.id, promptEngine.promptFragments, 2) : [];
  for (const item of fragments) {
    add(Math.min(item.score, 16), 'prompt-fragment', `${item.title} (${item.score})`);
    for (const match of item.matchedOn.slice(0, 3)) matchedOn.push(match);
  }

  const rankedTargets = (template.canonicalTargets || [])
    .map((target) => {
      return scoreTemplateTarget(query, target, templateDocs.get(target) || { title: '', snippet: '', text: '' }, getRouting(promptEngine));
    })
    .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target));

  for (const item of rankedTargets.slice(0, 2)) {
    if (item.score > 0) add(Math.min(item.score, 20), 'canonical-target', `${item.target} (${item.score})`);
  }

  if ((template.canonicalTargets || []).length) add(Math.min(template.canonicalTargets.length, 4), 'canonical-target-count', `${template.canonicalTargets.length} targets`);
  if (template.mappingConfidence === 'high') add(4, 'mapping-confidence', 'high');
  if (template.mappingConfidence === 'medium') add(2, 'mapping-confidence', 'medium');
  if (signals.promptIntelligence?.variants?.length) add(Math.min(signals.promptIntelligence.variants.length, 3), 'prompt-variant-count', `${signals.promptIntelligence.variants.length} variants`);
  if (signals.exactCases.length) add(Math.min(signals.exactCases.length, 4), 'exact-case-count', `${signals.exactCases.length} exact cases`);
  applyTemplateGuard({ query, queryTokens, templateId: template.id, add, promptEngine });
  applySpecialRouteBoosts({ query, queryTokens, templateId: template.id, add, promptEngine });

  const matchedReasons = new Set(matchedOn.map((item) => item.reason));
  const hasSpecializedPromptHit = matchedOn.some((item) => item.reason === 'prompt-variant' && !/常规模板|JSON 进阶模板/u.test(String(item.value || '')));
  const hasExactCaseQueryMatch = matchedReasons.has('case-exact-query-match');
  const hasGuardBoost = matchedReasons.has('template-guard-match');

  return {
    templateId: template.id,
    score,
    matchedOn: matchedOn.sort((a, b) => b.points - a.points).slice(0, 20),
    category: template.category,
    styles: template.styles || [],
    scenes: template.scenes || [],
    tags: template.tags || [],
    canonicalTargets: rankedTargets.map((item) => item.target),
    rankedTargets,
    promptIntelligence: signals.promptIntelligence ? {
      anchor: signals.promptIntelligence.anchor,
      sectionTitle: signals.promptIntelligence.sectionTitle,
      promptSource: signals.promptIntelligence.promptSource,
      selectedVariants: rankPromptVariants(query, signals.promptIntelligence.variants || [], 3).map((variant) => ({
        label: variant.label,
        format: variant.format,
        notes: variant.notes,
        prompt: variant.prompt,
        score: variant.score,
      })),
      pitfalls: signals.promptIntelligence.pitfalls || [],
    } : null,
    supportingCases: {
      exact: exactCaseHits.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        styles: item.styles,
        scenes: item.scenes,
        promptPreview: item.promptPreview,
        prompt: item.prompt,
        score: item.score,
      })),
      candidate: candidateCaseHits.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        styles: item.styles,
        scenes: item.scenes,
        promptPreview: item.promptPreview,
        prompt: item.prompt,
        score: item.score,
        candidateScore: item.candidateScore || 0,
      })),
    },
    summary: {
      useWhen: template.useWhen || null,
      guidance: template.guidance || null,
      pitfalls: template.pitfalls || null,
    },
    promptFragments: fragments.map((item) => ({
      title: item.title,
      taskFamily: item.taskFamily,
      summary: item.summary,
      structuralHints: item.structuralHints,
      score: item.score,
    })),
    disambiguationSignals: {
      hasSpecializedPromptHit,
      hasExactCaseQueryMatch,
      hasGuardBoost,
    },
  };
}

function rankTemplates(query, retrievalIndex, templateDocs, promptMaps, promptEngine, topN) {
  return retrievalIndex.templates
    .map((template) => scoreTemplate(query, template, retrievalIndex, templateDocs, promptMaps, promptEngine))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.templateId.localeCompare(b.templateId))
    .slice(0, topN);
}

function hasClearSpecializedWin(top, runnerUp) {
  if (!top || !runnerUp) return true;
  if (top.score - runnerUp.score >= 14) return true;
  if (top.disambiguationSignals?.hasGuardBoost && !runnerUp.disambiguationSignals?.hasGuardBoost) return true;
  if (
    top.disambiguationSignals?.hasExactCaseQueryMatch &&
    top.disambiguationSignals?.hasSpecializedPromptHit &&
    !runnerUp.disambiguationSignals?.hasExactCaseQueryMatch
  ) return true;
  return false;
}

function queryHasAnySignal(query, terms = []) {
  const queryText = String(query || '');
  const queryTokens = new Set(extractAsciiTokens(queryText));
  return terms.some((term) => containsPhrase(queryText, term) || queryTokens.has(String(term).toLowerCase()));
}

function buildGenericClarification(top, runnerUp, language, promptEngine) {
  const locale = language === 'zh' ? 'zh' : 'en';
  const profiles = getTemplateIntentProfiles(promptEngine);
  const topProfile = profiles[top.templateId]?.[locale];
  const runnerProfile = profiles[runnerUp.templateId]?.[locale];
  if (!topProfile || !runnerProfile) return null;
  return {
    language: locale,
    question: locale === 'zh' ? '为了更准地选方向，你更接近下面哪种目标？' : 'To pick the right direction more precisely, which goal is closer to what you want?',
    options: [
      { id: 'A', label: topProfile.label, description: topProfile.description, internalTemplateId: top.templateId },
      { id: 'B', label: runnerProfile.label, description: runnerProfile.description, internalTemplateId: runnerUp.templateId },
    ],
  };
}

function buildPairClarification(pairConfig, language, rankedById) {
  const locale = language === 'zh' ? 'zh' : 'en';
  const localized = pairConfig?.[locale];
  if (!localized) return null;
  const orderedOptions = [...localized.options].sort((a, b) => {
    const scoreA = rankedById.get(a.templateId)?.score || 0;
    const scoreB = rankedById.get(b.templateId)?.score || 0;
    return scoreB - scoreA;
  });
  return {
    language: locale,
    question: localized.question,
    options: orderedOptions.map((option, index) => ({
      id: String.fromCharCode(65 + index),
      label: option.label,
      description: option.description,
      internalTemplateId: option.templateId,
    })),
  };
}

function shouldForcePairClarification(query, pairConfig, rankedById, topTemplateId) {
  if (!pairConfig?.templates?.length || !topTemplateId) return false;
  const topInPair = pairConfig.templates.includes(topTemplateId);
  const templatePresent = pairConfig.templates.some((templateId) => rankedById.has(templateId));
  if (!topInPair && !templatePresent) return false;
  const sideSignals = pairConfig.trigger?.sideSignals || {};
  const hits = pairConfig.templates.map((templateId) => queryHasAnySignal(query, sideSignals[templateId] || []));
  if (pairConfig.trigger?.requireBothSides) return hits.every(Boolean);
  return hits.some(Boolean);
}

function maybeBuildClarification(query, ranked, promptEngine) {
  const [top, runnerUp] = ranked;
  if (!top) return null;

  const language = isChineseQuery(query) ? 'zh' : 'en';
  const rankedById = new Map(ranked.map((item) => [item.templateId, item]));

  for (const [key, pairConfig] of Object.entries(getPairwiseClarifiers(promptEngine))) {
    if (!shouldForcePairClarification(query, pairConfig, rankedById, top.templateId)) continue;
    const clarification = buildPairClarification(pairConfig, language, rankedById);
    if (!clarification) continue;
    return {
      needed: true,
      reason: language === 'zh'
        ? '用户输入同时包含两种不同的输出意图，先问一个最小选择题再锁模板更稳。'
        : 'The request mixes two different output intents. Ask one minimal either/or question before locking the template.',
      pair: key,
      ...clarification,
    };
  }

  if (!runnerUp) return null;
  if (hasClearSpecializedWin(top, runnerUp)) return null;
  const closeByGap = (top.score - runnerUp.score) <= 10;
  const closeByRatio = runnerUp.score > 0 && (top.score / runnerUp.score) <= 1.08;
  if (!closeByGap && !closeByRatio) return null;

  const pairConfig = getPairwiseClarifiers(promptEngine)[pairKey(top.templateId, runnerUp.templateId)];
  const clarification = pairConfig
    ? buildPairClarification(pairConfig, language, rankedById)
    : buildGenericClarification(top, runnerUp, language, promptEngine);
  if (!clarification) return null;
  return {
    needed: true,
    reason: language === 'zh'
      ? '前两个候选都比较合理，但会导向不同的 prompt 结构。先补一个最小澄清问题更稳。'
      : 'The top two candidates are both plausible but lead to different prompt structures. Ask one minimal clarification first.',
    pair: pairConfig ? pairKey(top.templateId, runnerUp.templateId) : null,
    ...clarification,
  };
}

function printHuman(query, ranked, clarification) {
  console.log('# Template Selection\n');
  console.log(`Query: ${query}\n`);
  if (!ranked.length) {
    console.log('No candidate matched strongly enough. Fall back to manual category narrowing.');
    return;
  }
  if (clarification?.needed) {
    console.log('## Clarification Needed');
    console.log(clarification.question);
    clarification.options.forEach((option) => console.log(`- ${option.id}. ${option.label}: ${option.description}`));
    console.log('');
  }
  ranked.forEach((item, index) => {
    console.log(`## ${index + 1}. ${item.templateId} (score ${item.score})`);
    console.log(`- Category: ${item.category}`);
    console.log(`- Styles: ${item.styles.join(', ') || 'None'}`);
    console.log(`- Scenes: ${item.scenes.join(', ') || 'None'}`);
    if (item.promptIntelligence) {
      console.log(`- Prompt section: ${item.promptIntelligence.sectionTitle}`);
      item.promptIntelligence.selectedVariants.forEach((variant) => console.log(`  - Prompt variant: ${variant.label} (score ${variant.score})`));
    }
    console.log(`- Canonical template targets:`);
    item.rankedTargets.slice(0, 4).forEach((target) => console.log(`  - ${target.target} (score ${target.score})`));
    if (item.supportingCases.exact.length || item.supportingCases.candidate.length) {
      console.log(`- Prompt evidence:`);
      item.supportingCases.exact.forEach((c) => console.log(`  - exact case ${c.id}: ${c.title} (score ${c.score})`));
      item.supportingCases.candidate.forEach((c) => console.log(`  - candidate case ${c.id}: ${c.title} (score ${c.score})`));
    }
    console.log(`- Matched on:`);
    item.matchedOn.slice(0, 10).forEach((match) => console.log(`  - [${match.points}] ${match.reason}: ${match.value}`));
    console.log('');
  });
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    printHelp();
    return;
  }

  const query = await readQuery(cfg.query, cfg.queryFile);
  const { retrievalIndex, promptIntelligenceIndex, promptCorpusIndex } = await readIndexes();
  const promptEngine = await loadPromptEngine();
  const templateDocs = await loadTemplateDocs(retrievalIndex);
  const promptMaps = buildPromptMaps(promptIntelligenceIndex, promptCorpusIndex);
  const ranked = rankTemplates(query, retrievalIndex, templateDocs, promptMaps, promptEngine, Math.max(1, cfg.top || 3));
  const clarification = maybeBuildClarification(query, ranked, promptEngine);

  const output = {
    query,
    selectionRule: `${retrievalIndex.source?.rule || 'category -> style -> scene -> exampleCases'} -> promptVariants -> promptCorpus`,
    schemaBoundary: retrievalIndex.schemaBoundary,
    promptSources: {
      promptIntelligence: promptIntelligenceIndex.source,
      promptCorpus: promptCorpusIndex.source,
      promptEngine: promptEngine.promptFragments.source,
    },
    clarification,
    candidates: ranked,
  };

  if (cfg.json) console.log(JSON.stringify(output, null, 2));
  else printHuman(query, ranked, clarification);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
