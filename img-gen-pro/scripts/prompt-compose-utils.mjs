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
  if (/technical-diagrams|system-architecture|flowchart|sequence-diagram|state-machine|er-diagram|mind-map|network-topology/.test(value)) return 'infographic';
  if (/editing-workflows\/multi-reference-composition|text-on-objects/.test(value)) return 'portrait-photo';
  if (/ui-mockups|dashboard|landing-page|social-interface|live-commerce/.test(value)) return 'ui-mockup';
  if (/personalized-beauty-report/.test(value)) return 'ecommerce-conversion';
  if (/infographics|scientific|diagram|report-page|visual-report|academic-figures/.test(value)) return 'infographic';
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
  return (principlesData.principles || []).filter((item) => (item.applies_to || []).includes(family));
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
  if (/竖版|竖屏/.test(text)) return ['social-post', 'ui-mockup'].includes(family) ? '9:16' : '3:4';
  if (/横版/.test(text)) return '16:9';
  if (/方图|正方形/.test(text)) return '1:1';
  const defaults = {
    'social-post': '9:16',
    'ui-mockup': '16:9',
    infographic: '3:4',
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
  const textHeavyFamilies = new Set(['infographic', 'ui-mockup', 'ecommerce-conversion', 'character-sheet', 'social-post']);

  const matchedTextCues = textCues.filter((cue) => text.includes(cue) || textLower.includes(cue));
  const matchedCriticalCues = criticalCues.filter((cue) => text.includes(cue) || textLower.includes(cue));
  const matchedDenseCues = denseTextCues.filter((cue) => text.includes(cue) || textLower.includes(cue));

  const textHeavy = textHeavyFamilies.has(family) || matchedTextCues.length > 0;
  const criticalTextPresent = matchedCriticalCues.length > 0;
  const inspectionRequired = textHeavy || criticalTextPresent;

  const riskNotes = [];
  if (criticalTextPresent) riskNotes.push('critical user-visible text is part of the task');
  if (matchedDenseCues.length) riskNotes.push('small or dense text zones are likely present and need explicit inspection');
  if (['infographic', 'ui-mockup', 'character-sheet', 'social-post'].includes(family)) {
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
  if (/label|labels|标注|callout|legend|图例/.test(text) || family === 'infographic') push('labels', '标签 / 标注区', 'labels anchor the explanatory structure');
  if (/nav|navigation|导航|kpi|dashboard/.test(text) || family === 'ui-mockup') push('ui-copy', '导航 / KPI / 模块标题区', 'screen text should feel interface-readable');
  if (!zones.length) {
    if (family === 'ecommerce-conversion') push('commerce-copy', '标题 / 价格 / CTA 区', 'default commerce text-bearing risk');
    else if (family === 'ui-mockup') push('ui-copy', '界面文字区', 'default UI text-bearing risk');
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
  const lines = [];
  lines.push(`Create a ${ratio} image for this request: ${effectiveRequest}`);
  if (platform !== 'unspecified') lines.push(`Use ${platform} platform / layout grammar only when it strengthens the requested output.`);
  if (brief?.title) lines.push(`Target outcome shape: ${brief.title}.`);

  const applicability = (brief?.applicability || []).slice(0, 3);
  if (applicability.length) {
    lines.push('Applicability anchors:');
    applicability.forEach((item) => lines.push(`- ${item}`));
  }

  const useWhen = (brief?.useWhen || []).slice(0, 4);
  if (useWhen.length) {
    lines.push('Use this structure when:');
    useWhen.forEach((item) => lines.push(`- ${item}`));
  }

  const variant = primarySelection?.promptIntelligence?.selectedVariants?.[0] || null;
  if (variant?.notes) lines.push(`Matched prompt direction: ${variant.label} — ${variant.notes}`);
  if (variant?.prompt) {
    lines.push('Matched prompt body to preserve semantically:');
    lines.push(variant.prompt);
  }

  if (fragments.length) {
    lines.push('Borrow these concrete structural cues from prompt exemplars:');
    fragments.slice(0, 3).forEach((entry) => {
      lines.push(`- ${entry.title}: ${entry.summary}`);
      (entry.structuralHints || []).slice(0, 5).forEach((hint) => lines.push(`  - ${hint}`));
    });
  }

  const principleSummary = (principles || []).slice(0, 6);
  if (principleSummary.length) {
    lines.push('High-signal prompt principles from prompt methodology:');
    principleSummary.forEach((item) => lines.push(`- ${item.title}: ${item.summary}`));
  }

  const requirements = taskSpecificRequirements(effectiveRequest, family, platform, ratio);
  if (requirements.length) {
    lines.push('Task requirements:');
    requirements.forEach((item) => lines.push(`- ${item}`));
  }

  const textRequirements = textRenderingRequirements(effectiveRequest, family, textInspection);
  if (textRequirements.length) {
    lines.push('Text rendering requirements:');
    textRequirements.forEach((item) => lines.push(`- ${item}`));
  }

  const antiPatterns = unique((principles || []).flatMap((item) => item.anti_patterns || []).concat(brief?.avoid || [])).slice(0, 12);
  if (antiPatterns.length) {
    lines.push('Avoid:');
    antiPatterns.forEach((item) => lines.push(`- ${item}`));
  }

  return `${lines.join('\n')}\n`;
}

export function buildRenderContract({ brief, promptDraft, ratio, platform, family }) {
  const canonicalJson = brief?.firstJsonTemplate || null;
  return {
    family,
    ratio,
    platform,
    canonicalSurfaceType: canonicalJson ? 'json-first' : 'structured-natural-language',
    finalHandoffType: 'normalized-text',
    canonicalJsonTemplate: canonicalJson,
    normalizedTextPrompt: promptDraft,
    hostReadyInput: {
      type: 'prompt-string',
      value: promptDraft,
    },
    notes: [
      canonicalJson
        ? 'The selected canonical template is JSON-first, but the current builder renders a normalized prompt string for model handoff.'
        : 'The selected canonical template is structured natural language and is handed off as a normalized prompt string.',
      'Mode A scripts consume prompt text via --prompt or --promptfile.',
      'Mode B host-native image tools should receive the normalized prompt string unless a future adapter explicitly maps to structured tool args.',
    ],
  };
}
