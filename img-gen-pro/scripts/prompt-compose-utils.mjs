import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeText,
  extractAsciiTokens,
  scorePhraseAndTokens,
} from './prompt-bridge-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(__dirname);
const dataDir = path.join(root, 'data');

const promptEngineDir = path.join(dataDir, 'prompt-engine');

export const promptEngineFiles = {
  fragments: path.join(promptEngineDir, 'fragments.json'),
  principles: path.join(promptEngineDir, 'principles.json'),
  clarifyRules: path.join(promptEngineDir, 'clarify-rules.json'),
  referenceMode: path.join(promptEngineDir, 'reference-mode.json'),
  overlapMap: path.join(promptEngineDir, 'overlap-map.json'),
  routing: path.join(promptEngineDir, 'routing.json'),
};

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function endSentence(text) {
  const cleaned = normalizeText(text).replace(/[。.!?;；,，]+$/u, '');
  return cleaned ? `${cleaned}.` : '';
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function loadPromptEngine() {
  const [promptFragments, principles, clarifyRules, referenceMode, overlapMap, routing] = await Promise.all([
    readJson(promptEngineFiles.fragments),
    readJson(promptEngineFiles.principles),
    readJson(promptEngineFiles.clarifyRules),
    readJson(promptEngineFiles.referenceMode),
    readJson(promptEngineFiles.overlapMap),
    readJson(promptEngineFiles.routing),
  ]);
  return { promptFragments, principles, clarifyRules, referenceMode, overlapMap, routing };
}

export function profileForTemplate(templateId, target, overlapMap) {
  const fromTemplate = overlapMap?.templates?.[templateId] || null;
  if (fromTemplate) return { templateId, target, ...fromTemplate };
  return {
    templateId,
    target,
    primaryTaskFamily: inferFamilyFromTarget(target),
    secondaryTaskFamilies: [],
    includeAny: [],
    excludeAny: [],
    limit: 8,
  };
}

export function inferFamilyFromTarget(target = '') {
  const value = normalizeText(target);
  if (/academic-figures|scientific-schematic|publication-chart|method-pipeline-overview/.test(value)) return 'academic-figure';
  if (/technical-diagrams|system-architecture|flowchart|sequence-diagram|state-machine|er-diagram|mind-map|network-topology/.test(value)) return 'technical-diagram';
  if (/editing-workflows\/multi-reference-composition|text-on-objects/.test(value)) return 'portrait-photo';
  if (/ui-mockups|dashboard|landing-page|social-interface|live-commerce/.test(value)) return 'ui-mockup';
  if (/personalized-beauty-report/.test(value)) return 'ecommerce-conversion';
  if (/infographics|scientific|diagram|report-page|visual-report/.test(value)) return 'infographic';
  if (/poster|campaign|typography/.test(value)) return 'poster-layout';
  if (/ecommerce|product-visuals|brand-identity|touchpoint/.test(value)) return 'ecommerce-conversion';
  if (/character-sheet|collectible|fashion-lookbook/.test(value)) return 'character-sheet';
  if (/portrait|street|scene|meme-and-viral-content/.test(value)) return 'portrait-photo';
  return 'generic';
}

export function rankFragments(query, templateId, promptFragmentsIndex, limit = 3) {
  const bundle = (promptFragmentsIndex.templates || []).find((item) => item.id === templateId);
  if (!bundle) return [];
  const queryTokens = new Set(extractAsciiTokens(query || ''));
  const ranked = (bundle.curatedEntries || []).map((entry, index) => {
    let score = Math.min(8, Math.round((entry.score || 0) / 12));
    const matchedOn = [];
    for (const spec of [
      { text: entry.title, phrasePoints: 16, tokenPoints: 5, cap: 18, reason: 'fragment-title' },
      { text: entry.summary, phrasePoints: 10, tokenPoints: 3, cap: 12, reason: 'fragment-summary' },
      { text: (entry.structuralHints || []).join(' \n '), phrasePoints: 8, tokenPoints: 3, cap: 12, reason: 'fragment-structure' },
      { text: (entry.textSignals || []).join(' '), phrasePoints: 6, tokenPoints: 2, cap: 8, reason: 'fragment-text-signal' },
      { text: entry.promptExcerpt, phrasePoints: 4, tokenPoints: 1, cap: 10, reason: 'fragment-prompt' },
    ]) {
      const result = scorePhraseAndTokens({ query, queryTokens, ...spec, label: entry.title });
      score += result.score;
      matchedOn.push(...result.matches);
    }
    return { ...entry, score, matchedOn, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked.slice(0, limit);
}

export function principlesForFamily(family, principlesData) {
  const familyAliases = {
    'academic-figure': ['infographic'],
    'technical-diagram': ['infographic'],
  };
  const families = new Set([family, ...(familyAliases[family] || [])]);
  return (principlesData.principles || []).filter((item) => (item.applies_to || []).some((appliesTo) => families.has(appliesTo)));
}

export function detectPlatform(request) {
  const text = normalizeText(request || '');
  if (/抖音|douyin/.test(text)) return 'Douyin / 抖音';
  if (/小红书|xiaohongshu/.test(text)) return 'Xiaohongshu / 小红书';
  if (/(^|\s)(x|twitter)(\s|$)|推特/.test(text)) return 'X / Twitter';
  if (/b站|bilibili/.test(text)) return 'Bilibili / B站';
  if (/youtube|油管/.test(text)) return 'YouTube';
  if (/instagram|ins/.test(text)) return 'Instagram';
  return 'unspecified';
}

export function detectRatio(request, family, defaultRatios = []) {
  const text = normalizeText(request || '');
  if (/9:16|9比16/.test(text)) return '9:16';
  if (/16:9|16比9/.test(text)) return '16:9';
  if (/1:1|1比1/.test(text)) return '1:1';
  if (/3:4|3比4/.test(text)) return '3:4';
  if (/4:5|4比5/.test(text)) return '4:5';
  if (family === 'ecommerce-conversion') {
    if (/landing page|hero|首屏|网页|website/.test(text)) return '16:9';
    if (/无拉链|没有拉链|无缝线|constraint-driven|no zipper|no seam/.test(text)) return '4:5';
    if (/product card|商品卡|方图/.test(text)) return '1:1';
    if (/内容图|竖版/.test(text)) return '4:5';
  }
  if (family === 'portrait-photo') {
    if (/多参考图|参考这两张图|放进那个|光线要统一|background swap|multi reference|composite/.test(text)) return '3:4';
  }
  if (family === 'ui-mockup') {
    if (/dashboard|saas|kpi|cash flow|告警|趋势图|系统架构|架构图|微服务/.test(text)) return '16:9';
    if (/直播|抖音|小红书|截图|short-video/.test(text)) return '9:16';
  }
  if (family === 'infographic') {
    if (/系统架构|架构图|微服务|api gateway|消息队列|postgresql|redis|sequence|state machine|er 图|拓扑|flowchart/.test(text)) return '16:9';
  }
  if (family === 'technical-diagram') {
    if (/系统架构|架构图|微服务|api gateway|消息队列|postgresql|redis|sequence|state machine|er 图|拓扑|flowchart|network|topology/.test(text)) return '16:9';
  }
  if (family === 'academic-figure') {
    if (/论文|期刊|paper|publication|figure|原理图|机制图|实验装置|scientific|schematic|mechanism/.test(text)) return '16:9';
  }
  if (/竖版|竖屏/.test(text)) return ['social-post', 'ui-mockup'].includes(family) ? '9:16' : '3:4';
  if (/横版/.test(text)) return '16:9';
  if (/方图|正方形/.test(text)) return '1:1';
  const defaults = {
    'social-post': '9:16',
    'ui-mockup': '16:9',
    infographic: '3:4',
    'technical-diagram': '16:9',
    'academic-figure': '16:9',
    'poster-layout': '3:4',
    'ecommerce-conversion': '4:5',
    'character-sheet': '16:9',
    'portrait-photo': '3:4',
    thumbnail: '16:9',
    generic: '3:4',
  };
  return defaultRatios[0] || defaults[family] || '3:4';
}

export function inferTextProfile(request, family) {
  const text = request || '';
  const textLower = normalizeText(text);
  const textCues = [
    '文字', '文案', '字样', '标题', '副标题', '牌子', '标语', '台词', '字幕',
    '按钮', 'cta', '价格', '评论区', '弹幕', '商品卡', '卖点', '徽章', '标签',
    'label', 'labels', 'text', 'copy', 'headline', 'badge', 'callout',
  ];
  const criticalCues = [
    '写', '文案', '字样', '标题', '牌子', '价格', '按钮', 'cta', '立即购买',
    '商品卡', '卖点', '徽章', '标签', '字幕', '台词', 'callout', 'headline',
  ];
  const denseTextCues = ['小字', '高密度', '信息图', '评论区', '弹幕', '商品卡', 'dashboard', '告警列表'];
  const textHeavyFamilies = new Set(['infographic', 'academic-figure', 'technical-diagram', 'ui-mockup', 'ecommerce-conversion', 'character-sheet', 'social-post']);

  const matchedTextCues = textCues.filter((cue) => text.includes(cue) || textLower.includes(cue));
  const matchedCriticalCues = criticalCues.filter((cue) => text.includes(cue) || textLower.includes(cue));
  const matchedDenseCues = denseTextCues.filter((cue) => text.includes(cue) || textLower.includes(cue));

  const textHeavy = textHeavyFamilies.has(family) || matchedTextCues.length > 0;
  const criticalTextPresent = matchedCriticalCues.length > 0;
  const inspectionRequired = textHeavy || criticalTextPresent;

  const riskNotes = [];
  if (criticalTextPresent) riskNotes.push('critical user-visible text is part of the task');
  if (matchedDenseCues.length) riskNotes.push('small or dense text zones are likely present and need explicit inspection');
  if (['infographic', 'academic-figure', 'technical-diagram', 'ui-mockup', 'character-sheet', 'social-post'].includes(family)) {
    riskNotes.push('the image depends on readable labels / UI copy, not just atmosphere');
  }
  if (family === 'ecommerce-conversion') {
    riskNotes.push('conversion images fail if headline / price / CTA / trust blocks are unreadable');
  }

  return {
    textHeavy,
    criticalTextPresent,
    textInspectionRequired: inspectionRequired,
    matchedTextCues,
    matchedCriticalTextCues: matchedCriticalCues,
    matchedDenseTextCues: matchedDenseCues,
    textRiskNotes: riskNotes,
  };
}

export function buildInspectionZones(request, family, textProfile) {
  if (!textProfile.textInspectionRequired) return [];
  const zones = [];
  const text = normalizeText(request || '');
  const push = (id, label, reason) => zones.push({ id, label, reason });
  if (/title|headline|标题|副标题/.test(text)) push('headline', '标题 / 主标题区', 'headline text is explicitly requested or implied');
  if (/price|¥|￥|元|报价|售价/.test(text)) push('price', '价格区', 'price readability is a conversion-critical requirement');
  if (/cta|立即购买|button|按钮|抢购|call to action/.test(text)) push('cta', 'CTA / 按钮区', 'call-to-action text must survive real viewing');
  if (/商品卡|product card|offer block/.test(text)) push('product-card', '商品卡 / Offer 区', 'commerce card text and hierarchy must read clearly');
  if (/评论区|弹幕|comment/.test(text)) push('social-overlay', '评论区 / 弹幕区', 'dense overlay text must not collapse into mush');
  if (/label|labels|标注|callout|legend|图例/.test(text) || ['infographic', 'academic-figure', 'technical-diagram'].includes(family)) push('labels', '标签 / 标注区', 'labels anchor the explanatory structure');
  if (/nav|navigation|导航|kpi|dashboard/.test(text) || family === 'ui-mockup') push('ui-copy', '导航 / KPI / 模块标题区', 'screen text should feel interface-readable');
  if (!zones.length) {
    if (family === 'ecommerce-conversion') push('commerce-copy', '标题 / 价格 / CTA 区', 'default commerce text-bearing risk');
    else if (family === 'ui-mockup') push('ui-copy', '界面文字区', 'default UI text-bearing risk');
    else if (family === 'technical-diagram') push('labels', '节点 / 连线 / 关系标注区', 'default technical diagram text-bearing risk');
    else if (family === 'academic-figure') push('labels', '标注 / 公式 / 图例区', 'default academic figure text-bearing risk');
    else if (family === 'infographic') push('labels', '标注 / 说明区', 'default infographic text-bearing risk');
    else push('general-text', '关键文字区', 'text-bearing request requires explicit check');
  }
  return unique(zones.map((item) => JSON.stringify(item))).map((value) => JSON.parse(value));
}

export function buildTextInspection(request, family) {
  const profile = inferTextProfile(request, family);
  const query = normalizeText(request || '');
  if (family === 'ecommerce-conversion' && /无拉链|没有拉链|无缝线|constraint-driven|no zipper|no seam/.test(query) && !/标题|文案|价格|按钮|cta|label|text|headline/.test(query)) {
    profile.textHeavy = false;
    profile.criticalTextPresent = false;
    profile.textInspectionRequired = false;
    profile.matchedTextCues = [];
    profile.matchedCriticalTextCues = [];
    profile.matchedDenseTextCues = [];
    profile.textRiskNotes = ['constraint-driven concept product request does not inherently require a text QA gate'];
  }
  return {
    ...profile,
    inspectionZones: buildInspectionZones(request, family, profile),
    verdict: profile.textInspectionRequired ? 'required' : 'not-required',
    deliveryRule: profile.textInspectionRequired
      ? 'Do not treat the image as final until critical text zones are explicitly checked and marked pass / retry / fail.'
      : 'No dedicated text gate required for this request.',
  };
}

function hasAny(text, patterns) {
  return (patterns || []).some((token) => normalizeText(text).includes(normalizeText(token)));
}

function mentionsAspectRatio(query = '') {
  return /9:16|9比16|16:9|16比9|1:1|1比1|3:4|3比4|4:5|4比5|竖版|竖屏|横版|方图|正方形/.test(query);
}

function inferTemplateAwareClarifications({ query, family, brief, platform, ratio }) {
  const text = normalizeText(query || '');
  const questions = [];
  const defaultsApplied = [];
  const questionOrder = brief?.questionOrder || [];
  const title = brief?.title || '';
  const questionText = questionOrder.join(' ');
  const askRatio = questionOrder.some((item) => /比例|aspect ratio|输出比例/i.test(item))
    && !/默认\s*16:9|默认\s*3:4|默认\s*4:5|很少竖版/.test(questionText)
    && !ratio;

  const pushQuestion = (item) => {
    if (questions.find((q) => q.id === item.id)) return;
    questions.push(item);
  };

  const looksLikeLivestream = /直播|livestream|live stream|带货|弹幕|商品卡/.test(text);
  const looksLikeSocial = /截图|screen|screenshot|社媒|小红书|抖音|b站|twitter|x /.test(text);
  const needsPlatform = (family === 'ui-mockup' || family === 'social-post')
    && /平台|界面语言|平台风格|平台|language/i.test(questionOrder.join(' '))
    && platform === 'unspecified';
  if (needsPlatform) {
    let options = ['通用 App / 网页界面', 'Dashboard / 设计系统板'];
    let defaultAnswer = '通用 App / 网页界面';
    if (looksLikeLivestream) {
      options = ['抖音/直播截图感', '通用中文直播样机', '通用 App / 网页界面'];
      defaultAnswer = '抖音/直播截图感';
    } else if (looksLikeSocial) {
      options = ['社媒截图感', '通用 App / 网页界面', 'Dashboard / 设计系统板'];
      defaultAnswer = '社媒截图感';
    }
    pushQuestion({
      id: 'platform-or-screen-type',
      question: '这次更接近哪种平台 / 界面语法？',
      options,
      defaultAnswer,
      source: 'template-aware',
    });
    defaultsApplied.push({ id: 'platform-or-screen-type', assumed: defaultAnswer });
  }

  const ratioIsImplicit = !mentionsAspectRatio(query);
  const ratioQuestionNeeded = ratioIsImplicit && askRatio;
  if (ratioQuestionNeeded) {
    let options = ['3:4 竖版', '4:5 竖版', '16:9 横版'];
    let defaultAnswer = ratio || '3:4';
    if (family === 'ui-mockup' && looksLikeLivestream) {
      options = ['竖版 9:16', '方图 1:1', '横版 16:9'];
      defaultAnswer = '竖版 9:16';
    } else if (family === 'ecommerce-conversion') {
      options = ['方图 1:1', '竖版 4:5', '横版 16:9'];
      defaultAnswer = ratio || '4:5';
    } else if (family === 'poster-layout') {
      options = ['3:4 竖版', '4:5 竖版', '16:9 横版'];
      defaultAnswer = ratio || '3:4';
    }
    pushQuestion({
      id: 'ratio',
      question: '这次最终要走什么比例？',
      options,
      defaultAnswer,
      source: 'template-aware',
    });
    defaultsApplied.push({ id: 'ratio', assumed: defaultAnswer });
  }

  const needsProductCategory = family === 'ecommerce-conversion'
    && /产品类目|品类|商品类型/i.test(questionText)
    && !/推荐品类|口红|底妆|护肤|beauty/.test(questionText)
    && !/美妆|护肤|数码|硬件|食品|饮料|服装|家电|serum|skincare|laptop|phone|snack|dior|lipstick|夹克|jacket/.test(text);
  if (needsProductCategory) {
    pushQuestion({
      id: 'product-category',
      question: '这次最该突出的主商品 / 品类是什么？',
      options: ['美妆/护肤', '数码/硬件', '食品/饮料'],
      defaultAnswer: '美妆/护肤',
      source: 'template-aware',
    });
    defaultsApplied.push({ id: 'product-category', assumed: '美妆/护肤' });
  }

  const needsStyleFork = family === 'portrait-photo'
    && /风格|真实感|rendering|摄影/i.test(questionOrder.join(' '))
    && !/胶片|纪实|棚拍|editorial|写实|摄影/.test(text);
  if (needsStyleFork) {
    pushQuestion({
      id: 'realism-mode',
      question: '这次你更偏哪种真实感方向？',
      options: ['街头抓拍', '胶片 / 纪实', '棚拍 / Editorial'],
      defaultAnswer: '棚拍 / Editorial',
      source: 'template-aware',
    });
    defaultsApplied.push({ id: 'realism-mode', assumed: '棚拍 / Editorial' });
  }

  return {
    needed: questions.length > 0,
    questions,
    defaultsApplied,
    maxRounds: 2,
    strategy: 'template-aware',
    signals: {
      family,
      title,
      questionOrder,
      platform,
      ratio,
    },
  };
}

export function buildSlotClarifications({ query, family, clarifyRules, allowDefaults = true, brief = null, platform = 'unspecified', ratio = null }) {
  const templateAware = inferTemplateAwareClarifications({ query, family, brief, platform, ratio });
  if (templateAware.needed) {
    return {
      ...templateAware,
      defaultsApplied: allowDefaults ? templateAware.defaultsApplied : [],
    };
  }

  const rules = clarifyRules.familyRules?.[family] || [];
  const questions = [];
  const defaultsApplied = [];
  for (const rule of rules) {
    if (rule.id === 'ratio' && ratio) continue;
    const shouldConsider = !rule.whenAny?.length || hasAny(query, rule.whenAny);
    const alreadySpecified = rule.requireAny?.length ? hasAny(query, rule.requireAny) : false;
    if (!shouldConsider || alreadySpecified) continue;
    questions.push({
      id: rule.id,
      question: rule.question,
      options: rule.options || [],
      defaultAnswer: rule.defaultAnswer || null,
      source: 'family-fallback',
    });
    if (allowDefaults && rule.defaultAnswer) defaultsApplied.push({ id: rule.id, assumed: rule.defaultAnswer });
    if (questions.length >= (clarifyRules.general?.maxQuestionsPerRound || 2)) break;
  }
  return {
    needed: questions.length > 0,
    questions,
    defaultsApplied,
    maxRounds: clarifyRules.general?.maxRounds || 2,
    strategy: 'family-fallback',
  };
}

export function taskSpecificRequirements(request, family, platform, ratio) {
  const text = request || '';
  if (family === 'social-post') {
    const reqs = [
      `Render the image as a believable ${platform !== 'unspecified' ? platform : 'social / livestream'} screenshot-style composition.`,
      'Include platform-native overlay hierarchy such as header, interaction layer, and bottom action area when implied.',
      'If the request mentions signs, spoken lines, or on-screen text, place them intentionally and keep them readable.',
      `Compose for ${ratio} with strong mobile-first readability.`,
    ];
    if (/带货|商品卡|评论区|弹幕|live commerce/i.test(text)) {
      reqs.push('Include believable commerce overlays such as product card, comments, and active interaction density.');
    }
    return reqs;
  }
  if (family === 'ui-mockup') {
    const reqs = [
      'Present the design as a structured UI / product board, not a generic abstract visual.',
      'Make section boundaries, components, and information architecture legible.',
      `Compose for ${ratio} and preserve screen / board readability.`,
    ];
    if (/dashboard|kpi|趋势图|导航|告警/i.test(text)) {
      reqs.push('Explicitly include KPI cards, chart modules, navigation, and alert / activity areas where relevant.');
    }
    if (/直播|截图|评论区|商品卡/i.test(text)) {
      reqs.push('Keep the platform grammar believable: header, comments, engagement layer, and product / offer area should read like a real screen.');
    }
    return reqs;
  }
  if (family === 'infographic') {
    return [
      'Use explicit information hierarchy rather than generic decoration.',
      'Organize the board into clearly separated sections, labels, callouts, and supporting explanatory blocks.',
      'If the topic is conceptual, make the comparison understandable at a glance.',
      `Compose for ${ratio} and keep the board self-contained.`,
    ];
  }
  if (family === 'technical-diagram') {
    return [
      'Render the image as a precise technical diagram with clear nodes, edges, labels, and directional relationships.',
      'Preserve the requested entities and relationships as the structure of the diagram, not as decorative captions.',
      'Use diagram grammar appropriate to the request, such as architecture blocks, ER entities, sequence lanes, flow steps, or topology nodes.',
      `Compose for ${ratio} with readable labels and unambiguous connectors.`,
    ];
  }
  if (family === 'academic-figure') {
    return [
      'Render the image as a publication-grade scientific figure with a clean explanatory structure.',
      'Preserve the requested scientific content, labels, formulae, arrows, and mechanism boundaries as first-order requirements.',
      'Use precise schematic hierarchy instead of decorative infographic filler.',
      `Compose for ${ratio} with labels and equations large enough to inspect.`,
    ];
  }
  if (family === 'poster-layout') {
    return [
      'Treat the image as a finished poster with a clear visual hierarchy.',
      'Decide what plays the hero role: title typography, subject, or campaign object, then support it consistently.',
      `Compose for ${ratio} with strong poster-grade hierarchy and finish.`,
    ];
  }
  if (family === 'ecommerce-conversion') {
    return [
      'Optimize for conversion clarity: product, benefit, proof, and CTA must all be easy to parse.',
      'Do not let decorative styling overpower the product itself.',
      'If the request implies badges, trust marks, or proof blocks, make them explicit instead of leaving them implicit.',
      `Compose for ${ratio} with clear commercial hierarchy.`,
    ];
  }
  if (family === 'character-sheet') {
    return [
      'Treat this as an organized reference board, not a single beauty shot.',
      'Maintain the same identity, face, hair, and outfit logic across all required views and variants.',
      'Make room for front / side / back views, expression deltas, parts breakdown, and palette / labels.',
      `Compose for ${ratio} while keeping each sub-panel legible.`,
    ];
  }
  if (family === 'portrait-photo') {
    return [
      'Prioritize photographic believability over decorative beauty language.',
      'Use environment, lighting, texture, and imperfection cues to make the image feel observed rather than fabricated.',
      'If the task involves image fusion or unusual text-bearing surfaces, make physical integration and realism the main constraint.',
      `Compose for ${ratio} with a natural camera perspective.`,
    ];
  }
  return [
    'Solve the visual task faithfully before optimizing for style.',
    `Compose for ${ratio} with clear intentional structure.`,
  ];
}

export function textRenderingRequirements(request, family, textInspection) {
  if (!textInspection.textInspectionRequired) return [];
  const reqs = [
    'If the image includes visible text, make it intentionally designed and genuinely readable rather than vague pseudo-text.',
    'Keep critical copy separated from busy backgrounds so it survives normal viewing, not just thumbnail-level inspection.',
  ];
  if (textInspection.criticalTextPresent) reqs.push('Treat explicitly requested titles, prices, CTA buttons, labels, and product-card copy as critical text.');
  if (textInspection.matchedDenseTextCues.length) reqs.push('Do not collapse small or dense text zones into mush; simplify, enlarge, or space them so they still read as believable text.');
  if (family === 'ecommerce-conversion') reqs.push('In conversion images, headline, price, CTA, and trust / proof text should read clearly at a glance.');
  if (family === 'ui-mockup') reqs.push('In UI / dashboard images, navigation labels, KPI blocks, and module headings should feel screen-readable rather than decorative gibberish.');
  if (family === 'infographic') reqs.push('In infographics, section labels and key comparison text should anchor the board instead of dissolving into ornamental pseudo-text.');
  return reqs;
}

export function buildReferenceRebuild({
  referenceImage,
  referenceImageSummary,
  referenceUserIntent = '',
  referenceKeep = '',
  referenceChange = '',
}) {
  const notes = [];
  let roughPromptGuess = normalizeText(referenceImageSummary || '');
  let backendUsed = roughPromptGuess ? 'multimodal-controller-summary' : (referenceImage ? 'image-present-no-summary-yet' : 'text-only-rebuild');

  if (!roughPromptGuess) {
    if (referenceImage && !referenceUserIntent) {
      throw new Error('Reference-image mode needs a visual summary from the multimodal controller. Inspect the image directly in the LLM, then pass --reference-image-summary.');
    }
    roughPromptGuess = normalizeText(referenceUserIntent || '');
    if (!roughPromptGuess) {
      throw new Error('Reference-image mode needs --reference-image-summary or --reference-user-intent so a rough prompt guess can be built.');
    }
    backendUsed = referenceImage ? 'user-intent-only-fallback' : 'text-only-rebuild';
    notes.push(referenceImage
      ? 'no explicit image summary was provided; rebuilt request is using user intent only and may miss visual specifics'
      : 'used user-intent-only rebuild path');
  } else if (referenceImage) {
    notes.push('reference-image semantics are multimodal-LLM-first: the controller should inspect the image directly and pass a concise visual summary here');
  }

  const keepNote = normalizeText(referenceKeep || (referenceChange || referenceUserIntent ? '参考图的主体关系、构图、风格气质、主色调与光影方向' : '尽量贴近参考图的主体、构图、风格、色调与光影'));
  const changeNote = normalizeText(referenceChange || '');
  const rebuiltRequest = [
    `参考图粗 prompt 猜测：${endSentence(roughPromptGuess)}`,
    keepNote ? `优先保留：${endSentence(keepNote)}` : '',
    changeNote ? `明确修改：${endSentence(changeNote)}` : '',
    referenceUserIntent ? `用户补充目标：${endSentence(referenceUserIntent)}` : '',
  ].filter(Boolean).join(' ');
  const selectionQuery = normalizeText([
    roughPromptGuess,
    changeNote,
    referenceUserIntent,
  ].filter(Boolean).join(' '));
  return {
    entryMode: 'reference-image',
    referenceImage: referenceImage || null,
    backendUsed,
    roughPromptGuess,
    keepNote,
    changeNote,
    userIntent: normalizeText(referenceUserIntent),
    rebuiltRequest,
    selectionQuery,
    notes: [
      ...notes,
      'reference-image mode stays a lightweight rebuild path',
      'the rebuilt request must re-enter the normal builder chain',
      'image understanding should come from the multimodal LLM controller, not an assumed external CV backend',
      'do not claim exact prompt / seed / parameter recovery',
    ],
  };
}

const ARGUMENT_PLACEHOLDER_RE = /\{argument\s+name=(?:"([^"]+)"|'([^']+)'|([^}\s]+))\s+default=(?:"([^"]*)"|'([^']*)'|([^}\s]*))\}/g;

function resolveTemplateArgumentPlaceholders(value) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplateArgumentPlaceholders(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplateArgumentPlaceholders(item)]),
    );
  }
  if (typeof value !== 'string') return value;
  return value.replace(ARGUMENT_PLACEHOLDER_RE, (_match, dqName, sqName, bareName, dqDefault, sqDefault, bareDefault) => {
    const fallbackName = dqName || sqName || bareName || '';
    return dqDefault ?? sqDefault ?? bareDefault ?? fallbackName;
  });
}

function requestWantsCleanAcademicSurface(request, family) {
  const text = String(request || '');
  return ['academic-figure', 'technical-diagram', 'infographic'].includes(family)
    && /白底|white background|论文|学术|顶级期刊|Nature|Science|CHI|publication|paper|矢量|vector/i.test(text)
    && !/暗色|dark|black background|黑底/i.test(text);
}

function filterConflictingStyleStrings(items) {
  const patterns = [
    /暗色|deep slate|黑底|dark background/i,
    /README|blog|头图/i,
    /baoyu-diagram/i,
    /工程感/i,
  ];
  return (items || []).filter((item) => !patterns.some((pattern) => pattern.test(String(item || ''))));
}

function applyCleanAcademicSurfaceOverrides(promptObject, request, family) {
  if (!requestWantsCleanAcademicSurface(request, family)) return promptObject;

  if (typeof promptObject.type === 'string') {
    promptObject.type = promptObject.type
      .replace(/（暗色工程感）/g, '（学术白底矢量版）')
      .replace(/暗色工程感/g, '学术白底矢量');
  }
  promptObject.goal = 'Generate a publication-grade clean vector diagram for the requested content, suitable for an academic paper figure.';

  if (promptObject.canvas && typeof promptObject.canvas === 'object') {
    promptObject.canvas.background = 'clean white #FFFFFF with optional very subtle light-gray alignment guides only if they improve readability';
    promptObject.canvas.outer_padding = promptObject.canvas.outer_padding || '60px';
  }

  if (promptObject.title_strip && typeof promptObject.title_strip === 'object') {
    promptObject.title_strip.subtitle = 'publication-style technical figure';
    promptObject.title_strip.position = 'top-left or omitted if a journal-style figure should rely on labels instead of a banner';
  }

  if (promptObject.node_style && typeof promptObject.node_style === 'object') {
    promptObject.node_style.fill = 'white or very light role-tinted fill with high readability on a white background';
    promptObject.node_style.label = 'high-contrast dark neutral text, readable at normal figure size';
  }

  if (promptObject.legend && typeof promptObject.legend === 'object') {
    promptObject.legend.style = 'minimal white-background figure legend with thin gray border and readable dark text';
  }

  if (promptObject.constraints && typeof promptObject.constraints === 'object') {
    promptObject.constraints.must_keep = [
      ...filterConflictingStyleStrings(promptObject.constraints.must_keep),
      'clean white academic figure surface',
      'vector-style diagram grammar with readable labels',
    ];
    promptObject.constraints.avoid = [
      ...filterConflictingStyleStrings(promptObject.constraints.avoid),
      'dark README/blog engineering-dashboard styling when the request asks for a white academic paper figure',
    ];
  }

  promptObject.style_overrides = {
    reason: 'user requested a white-background academic/vector figure; incompatible dark engineering template defaults were replaced inside the JSON object',
    surface: 'clean white academic vector figure',
  };

  return promptObject;
}

export function composePromptDraft({
  effectiveRequest,
  brief,
  family,
  ratio,
  platform,
  textInspection,
  primarySelection,
  fragments,
  principles,
}) {
  let canonical = null;
  if (brief?.firstJsonTemplate) {
    try {
      canonical = JSON.parse(brief.firstJsonTemplate);
    } catch {
      canonical = null;
    }
  }
  const variant = primarySelection?.promptIntelligence?.selectedVariants?.[0] || null;
  const requirements = taskSpecificRequirements(effectiveRequest, family, platform, ratio);
  const textRequirements = textRenderingRequirements(effectiveRequest, family, textInspection);
  const antiPatterns = unique((principles || []).flatMap((item) => item.anti_patterns || []).concat(brief?.avoid || [])).slice(0, 12);
  const canonicalPrompt = canonical && typeof canonical === 'object' && !Array.isArray(canonical)
    ? resolveTemplateArgumentPlaceholders(canonical)
    : null;
  const promptObject = canonicalPrompt
    ? { ...canonicalPrompt }
    : {
      type: brief?.title || family || 'image_generation_task',
      goal: 'Generate the requested image using the selected canonical template structure.',
    };
  applyCleanAcademicSurfaceOverrides(promptObject, effectiveRequest, family);

  promptObject.user_request = effectiveRequest;
  promptObject.output = {
    aspect_ratio: ratio,
    platform: platform === 'unspecified' ? null : platform,
    format_contract: 'This prompt is a strict JSON object serialized as the image prompt string.',
  };
  promptObject.selected_template = {
    target: brief?.target || null,
    title: brief?.title || null,
    family,
    canonical_surface_type: canonical ? 'json-first' : 'json-generated-from-structured-template',
    applicability: (brief?.applicability || []).slice(0, 3),
    use_when: (brief?.useWhen || []).slice(0, 4),
  };
  if (variant?.notes) {
    promptObject.matched_prompt_direction = {
      label: variant.label,
      notes: variant.notes,
    };
  }
  promptObject.prompt_exemplars = (fragments || []).slice(0, 3).map((entry) => ({
    title: entry.title,
    summary: entry.summary,
    structural_hints: (entry.structuralHints || []).slice(0, 5),
  }));
  promptObject.prompt_principles = (principles || []).slice(0, 6).map((item) => ({
    title: item.title,
    summary: item.summary,
  }));
  promptObject.task_requirements = requirements;
  promptObject.text_rendering_requirements = textRequirements;
  promptObject.text_inspection = {
    required: Boolean(textInspection?.textInspectionRequired),
    zones: textInspection?.inspectionZones || [],
    delivery_rule: textInspection?.deliveryRule || null,
  };
  promptObject.avoid = antiPatterns;
  return `${JSON.stringify(promptObject, null, 2)}\n`;
}

export function buildRenderContract({ brief, promptDraft, ratio, platform, family }) {
  const canonicalJson = brief?.firstJsonTemplate || null;
  return {
    family,
    ratio,
    platform,
    canonicalSurfaceType: canonicalJson ? 'json-first' : 'structured-natural-language',
    finalHandoffType: 'json-prompt-string',
    promptFormat: 'json',
    canonicalJsonTemplate: canonicalJson,
    jsonPrompt: promptDraft,
    hostReadyInput: {
      type: 'prompt-string',
      format: 'json',
      value: promptDraft,
    },
    notes: [
      canonicalJson
        ? 'The selected canonical template is JSON-first; the final image prompt is the rendered JSON object serialized as a prompt string.'
        : 'The selected canonical template has no JSON block; the final image prompt is a generated strict JSON object serialized as a prompt string.',
      'Mode A scripts consume prompt text via --prompt or --promptfile; the prompt text itself must remain valid JSON.',
      'Mode B host-native image tools should receive the JSON prompt string directly.',
    ],
  };
}
