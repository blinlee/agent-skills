import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(path.dirname(__dirname));
const dataDir = path.join(skillRoot, 'data');
const overlapMapFile = path.join(dataDir, 'prompt-engine', 'overlap-map.json');
const promptMethodSourceRoot = '/home/ubuntu/.openclaw/skills/codex-text-to-image';
const promptMethodSourcePaths = {
  templatesIndex: path.join(promptMethodSourceRoot, 'data', 'source', 'templates-index.json'),
  promptTaxonomy: path.join(promptMethodSourceRoot, 'data', 'compiled', 'prompt-taxonomy.json'),
  principles: path.join(promptMethodSourceRoot, 'data', 'compiled', 'principles.json'),
  principlesMd: path.join(promptMethodSourceRoot, 'references', 'prompt-design-principles.md'),
  clarifyRules: path.join(promptMethodSourceRoot, 'references', 'clarify-rules.md'),
  referenceImageMode: path.join(promptMethodSourceRoot, 'references', 'reference-image-mode.md'),
};

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function cleanText(value = '') {
  return String(value)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeText(value = '') {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

function matchesNeedle(haystack, needle) {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);
  if (!normalizedNeedle) return false;
  if (/[\u4e00-\u9fff]/.test(normalizedNeedle) || /\s/.test(normalizedNeedle) || /[^a-z0-9+-]/.test(normalizedNeedle)) {
    return normalizedHaystack.includes(normalizedNeedle);
  }
  const escaped = normalizedNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalizedHaystack);
}

function containsAny(text, tokens = []) {
  const haystack = normalizeText(text);
  return (tokens || []).some((token) => matchesNeedle(haystack, token));
}

function tokenize(text) {
  return unique(normalizeText(text).match(/[a-z0-9\u4e00-\u9fff][a-z0-9\u4e00-\u9fff+\- ]{1,}/g) || []);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function maybeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function flattenStrings(value, bucket = []) {
  if (value == null) return bucket;
  if (typeof value === 'string') {
    const cleaned = cleanText(value);
    if (cleaned) bucket.push(cleaned);
    return bucket;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    bucket.push(String(value));
    return bucket;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => flattenStrings(item, bucket));
    return bucket;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => flattenStrings(item, bucket));
  }
  return bucket;
}

function extractInterestingSignals(text) {
  const lower = normalizeText(text);
  const candidates = [
    ['headline', /headline|title|subtitle|hero/i],
    ['cta', /cta|call to action|button|立即购买|抢|buy now/i],
    ['price', /price|¥|￥|\$|元/],
    ['product card', /product card|商品卡|offer block/i],
    ['comments', /comment|comments|弹幕|评论区/i],
    ['navigation', /navigation|nav|导航/i],
    ['chart', /chart|graph|kpi|trend|图表/i],
    ['labels', /label|labels|callout|标签|标注/i],
    ['views', /front|side|back|三视图|正面|侧面|背面/i],
    ['palette', /palette|color|配色|色板/i],
    ['packaging', /package|packaging|包装/i],
    ['livestream', /live stream|livestream|直播/i],
    ['social profile', /social media|profile|帖子|账号/i],
    ['map', /map|atlas|城市图|地图/i],
  ];
  return candidates.filter(([, regex]) => regex.test(lower)).map(([label]) => label);
}

function extractStructuralHintsFromJson(parsed) {
  const hints = [];
  if (!parsed || typeof parsed !== 'object') return hints;

  const type = cleanText(parsed.type || parsed.theme || parsed.overall_aesthetic || '');
  if (type) hints.push(`type/theme: ${type}`);

  const header = parsed.header || {};
  for (const key of ['title', 'headline', 'subtitle', 'logo', 'top_right_tag']) {
    if (typeof header[key] === 'string' && cleanText(header[key])) {
      hints.push(`header ${key}: ${cleanText(header[key]).slice(0, 120)}`);
    }
  }

  const sections = parsed.layout?.sections || parsed.sections;
  if (Array.isArray(sections)) {
    sections.slice(0, 8).forEach((section) => {
      if (!section || typeof section !== 'object') return;
      const title = cleanText(section.title || section.name || section.type || 'section');
      const parts = [];
      if (section.count) parts.push(`count ${section.count}`);
      if (Array.isArray(section.labels) && section.labels.length) parts.push(`labels ${section.labels.slice(0, 4).join(', ')}`);
      if (Array.isArray(section.items) && section.items.length) parts.push(`items ${section.items.slice(0, 4).join(', ')}`);
      if (Array.isArray(section.variants) && section.variants.length) parts.push(`variants ${section.variants.slice(0, 4).join(', ')}`);
      if (typeof section.description === 'string') parts.push(cleanText(section.description).slice(0, 180));
      if (typeof section.layout_type === 'string') parts.push(`layout ${cleanText(section.layout_type)}`);
      if (typeof section.visual === 'string') parts.push(`visual ${cleanText(section.visual).slice(0, 120)}`);
      if (typeof section.title === 'string' && /cta|call to action/i.test(section.title)) parts.push('cta section');
      hints.push(`section ${title}${parts.length ? `: ${parts.join('; ')}` : ''}`);
    });
  }

  const flat = flattenStrings(parsed).join(' \n ');
  for (const signal of extractInterestingSignals(flat)) {
    hints.push(`signal: ${signal}`);
  }
  return unique(hints).slice(0, 18);
}

function buildPromptRecord(entry) {
  const promptText = cleanText(entry.prompt || '');
  const parsed = promptText.startsWith('{') ? maybeJson(promptText) : null;
  const structuralHints = parsed ? extractStructuralHintsFromJson(parsed) : [];
  const textSignals = extractInterestingSignals(`${entry.title}\n${entry.summary}\n${promptText}`);
  const promptExcerpt = promptText.slice(0, 1200);
  return {
    sourceId: `${entry.category_slug || 'unknown'}#${entry.index}`,
    sourceFile: entry.source_file,
    categorySlug: entry.category_slug,
    taskFamily: entry.task_family,
    title: entry.title,
    summary: cleanText(entry.summary || ''),
    sourceUrl: entry.source || '',
    promptFormat: parsed ? 'json' : 'text',
    promptExcerpt,
    structuralHints,
    textSignals,
    keywordBag: unique(tokenize(`${entry.title}\n${entry.summary}\n${promptExcerpt}`).slice(0, 80)),
  };
}

function matchesSignal(record, signals = []) {
  const haystack = normalizeText([
    ...(record.structuralHints || []),
    ...(record.textSignals || []),
    record.title,
    record.summary,
    record.promptExcerpt,
  ].join('\n'));
  return containsAny(haystack, signals);
}

function scoreOverlap(record, rule) {
  let score = 0;
  const haystack = normalizeText(`${record.title}\n${record.summary}\n${record.promptExcerpt}`);
  const titleStack = normalizeText(record.title || '');
  if (record.taskFamily === rule.primaryTaskFamily) score += 36;
  if ((rule.secondaryTaskFamilies || []).includes(record.taskFamily)) score += 22;
  if ((rule.preferredCategorySlugs || []).includes(record.categorySlug)) score += 24;
  if ((rule.bannedCategorySlugs || []).includes(record.categorySlug)) score -= 42;
  if ((rule.preferredPromptFormats || []).includes(record.promptFormat)) score += 6;
  if ((rule.bannedPromptFormats || []).includes(record.promptFormat)) score -= 12;
  for (const token of rule.includeAny || []) {
    if (matchesNeedle(haystack, token)) score += 10;
  }
  for (const token of rule.preferAny || []) {
    if (matchesNeedle(haystack, token)) score += 8;
  }
  for (const token of rule.excludeAny || []) {
    if (matchesNeedle(haystack, token)) score -= 18;
  }
  for (const token of rule.bannedAny || []) {
    if (matchesNeedle(haystack, token)) score -= 48;
  }
  if ((rule.requireTitleAny || []).length) {
    if ((rule.requireTitleAny || []).some((token) => matchesNeedle(titleStack, token))) score += 18;
    else score -= 30;
  }
  if ((rule.requireAny || []).length) {
    if ((rule.requireAny || []).some((token) => matchesNeedle(haystack, token))) score += 14;
    else score -= 26;
  }
  if ((rule.requireSignalAny || []).length) {
    if (matchesSignal(record, rule.requireSignalAny)) score += 16;
    else score -= 24;
  }
  if ((rule.preferSignalAny || []).length && matchesSignal(record, rule.preferSignalAny)) score += 8;
  score += Math.min(18, record.structuralHints.length * 2);
  score += Math.min(10, record.textSignals.length * 2);
  return score;
}

function passesOverlapRule(record, rule, score) {
  const haystack = normalizeText(`${record.title}\n${record.summary}\n${record.promptExcerpt}`);
  const titleStack = normalizeText(record.title || '');
  if ((rule.bannedCategorySlugs || []).includes(record.categorySlug)) return false;
  if ((rule.bannedAny || []).length && containsAny(haystack, rule.bannedAny)) return false;
  if ((rule.strictIncludeAny || []).length && !containsAny(haystack, rule.strictIncludeAny)) return false;
  if ((rule.requireAny || []).length && !containsAny(haystack, rule.requireAny)) return false;
  if ((rule.requireTitleAny || []).length && !containsAny(titleStack, rule.requireTitleAny)) return false;
  if ((rule.requireSignalAny || []).length && !matchesSignal(record, rule.requireSignalAny)) return false;
  return score >= (rule.minScore || 30);
}

function dedupeCuratedEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = normalizeText(`${entry.title}::${entry.summary}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

async function buildRoutingConfig() {
  const module = await import(path.join(skillRoot, 'scripts', 'prompt-routing-config-source.mjs'));
  return {
    generatedAt: new Date().toISOString(),
    source: {
      generatedBy: 'scripts/prompt-routing-config-source.mjs',
      rule: 'central runtime routing semantics for selector / brief / builder'
    },
    ...module.ROUTING_CONFIG_SOURCE,
  };
}

function buildClarifyRules() {
  return {
    generatedAt: new Date().toISOString(),
    source: {
      clarifyRules: 'prompt-method-source/references/clarify-rules.md',
      rule: 'absorb high-impact clarify discipline without exposing internal template identities'
    },
    general: {
      maxRounds: 2,
      maxQuestionsPerRound: 3,
      preferConvergentQuestions: true,
      allowSafeDefaultsWhenUserWantsSpeed: true,
      askOnlyIfItChangesOutcome: true
    },
    familyRules: {
      'ui-mockup': [
        {
          id: 'platform-or-screen-type',
          whenAny: ['live', '直播', '截图', 'screenshot', '社媒', 'dashboard', 'app', '网页'],
          requireAny: ['抖音', 'douyin', '小红书', 'xiaohongshu', 'x', 'twitter', 'b站', 'bilibili', 'youtube', 'dashboard', 'landing', 'design system', 'app', '网页'],
          question: '这张图更像哪类界面？',
          options: ['抖音/直播截图感', '通用 App / 网页界面', 'Dashboard / 设计系统板'],
          defaultAnswer: '通用 App / 网页界面'
        },
        {
          id: 'ratio',
          whenAny: ['ui', '界面', 'dashboard', 'landing', '直播', '截图'],
          requireAny: ['9:16', '1:1', '16:9', '3:4', '4:5', '竖版', '横版', '方图'],
          question: '比例还没定：你要竖版 9:16、方图 1:1，还是横版 16:9？',
          options: ['竖版 9:16', '方图 1:1', '横版 16:9'],
          defaultAnswer: '横版 16:9'
        }
      ],
      'ecommerce-conversion': [
        {
          id: 'product-category',
          whenAny: ['product', '商品', '电商', 'landing', 'hero', '广告', 'campaign', 'beauty', '护肤'],
          requireAny: ['护肤', '美妆', 'beauty', '服饰', 'fashion', '数码', 'tech', '饮料', 'food', '品牌', 'product'],
          question: '主商品和品类还不够明确：这是卖什么的，最该突出的产品是什么？',
          options: ['美妆/护肤', '数码/硬件', '食品/饮料'],
          defaultAnswer: '按用户文本里最明显的主商品理解'
        },
        {
          id: 'ratio',
          whenAny: ['hero', 'landing', '电商', '商品卡', 'cta'],
          requireAny: ['1:1', '4:5', '16:9', '9:16', '方图', '竖版', '横版'],
          question: '电商图比例还没定：你想要方图商品卡、4:5 竖版内容图，还是横版 hero？',
          options: ['方图 1:1', '竖版 4:5', '横版 16:9'],
          defaultAnswer: '竖版 4:5'
        }
      ],
      infographic: [
        {
          id: 'infographic-subtype',
          whenAny: ['信息图', 'infographic', 'explainer', 'diagram', 'atlas', 'workflow', 'map'],
          requireAny: ['对比', 'comparison', '流程', 'workflow', '时间线', 'timeline', '地图', 'map', '拆解', 'breakdown', 'scale', 'atlas'],
          question: '这张信息图更偏哪种结构？',
          options: ['对比 / 讲解', '流程 / 时间线', '地图 / 拆解 / 比例图'],
          defaultAnswer: '对比 / 讲解'
        },
        {
          id: 'ratio',
          whenAny: ['信息图', 'infographic', 'slide', 'atlas'],
          requireAny: ['3:4', '4:5', '16:9', '9:16', '竖版', '横版'],
          question: '信息图比例还没定：你要竖版 3:4 / 4:5，还是横版 16:9？',
          options: ['3:4 竖版', '4:5 竖版', '16:9 横版'],
          defaultAnswer: '3:4 竖版'
        }
      ],
      'poster-layout': [
        {
          id: 'poster-purpose',
          whenAny: ['海报', 'poster', 'campaign', 'promo', 'cover'],
          requireAny: ['活动', 'campaign', '产品', 'product', '品牌', 'brand', '赛事', 'sport', '杂志', 'editorial'],
          question: '这张海报更偏哪类用途？',
          options: ['活动 / Campaign', '产品 / 品牌宣传', '杂志 / 封面感'],
          defaultAnswer: '产品 / 品牌宣传'
        }
      ],
      'character-sheet': [
        {
          id: 'consistency-scope',
          whenAny: ['角色', '设定', '一致性', '资料卡', 'character'],
          requireAny: ['正面', '侧面', '背面', 'front', 'side', 'back', '表情', 'expression', '穿搭', 'outfit'],
          question: '你更需要哪种一致性结构？',
          options: ['正/侧/背多视图', '表情 / 动作变化', '穿搭 / 部件拆解'],
          defaultAnswer: '正/侧/背多视图'
        }
      ],
      'portrait-photo': [
        {
          id: 'realism-mode',
          whenAny: ['portrait', 'photo', '写实', '摄影', '抓拍', 'candid', 'flash'],
          requireAny: ['抓拍', 'candid', '胶片', 'film', '棚拍', 'studio', '纪实', 'documentary', 'editorial'],
          question: '真实感方向还没定：你更想要街头抓拍、胶片纪实，还是更稳定的棚拍 / editorial？',
          options: ['街头抓拍', '胶片 / 纪实', '棚拍 / Editorial'],
          defaultAnswer: '街头抓拍'
        }
      ]
    }
  };
}

function buildReferenceModeContract(referenceModeMd) {
  return {
    generatedAt: new Date().toISOString(),
    source: 'prompt-method-source/references/reference-image-mode.md',
    note: 'reference-image ingestion stays a lightweight rebuild path that re-enters the normal builder chain; in this repo the multimodal controller is expected to inspect the image directly',
    workflow: {
      goals: [
        'roughly recreate a reference image',
        'recreate it with targeted edits',
        'guess a similar prompt first, then optimize it through the main builder'
      ],
      preserve: [
        'subject',
        'framing / composition',
        'style and palette',
        'lighting',
        'layout hierarchy when the image is UI / poster / ecommerce / infographic'
      ],
      doNotPromise: [
        'exact original prompt',
        'original seed / sampler / model stack',
        'pixel-identical recovery'
      ],
      controllerExpectation: 'use the multimodal LLM to inspect the reference image and pass a concise visual summary into the builder',
      intermediateArtifacts: ['rough prompt guess', 'keep / change note'],
      rawExcerpt: cleanText(referenceModeMd).slice(0, 1000)
    }
  };
}

function extractPrincipleSections(markdown) {
  const matches = [...markdown.matchAll(/^##\s+(\d+)\.\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length;
    const body = cleanText(markdown.slice(start, end));
    return {
      order: Number.parseInt(match[1], 10),
      title: cleanText(match[2]),
      body,
      summary: cleanText(body.split(/\n\n+/)[0] || ''),
    };
  });
}

function buildSupplementalPrinciples(principlesMd, existingPrinciples = []) {
  const existingIds = new Set((existingPrinciples || []).map((item) => item.id));
  const sections = extractPrincipleSections(principlesMd);
  const byTitle = new Map(sections.map((section) => [section.title, section]));
  const specs = [
    {
      title: '好 prompt 不是堆形容词，而是补齐关键槽位',
      principle: {
        id: 'fill-critical-slots-not-adjectives',
        applies_to: ['poster-layout', 'infographic', 'ecommerce-conversion', 'ui-mockup', 'portrait-photo', 'character-sheet'],
        signals: ['objective', 'subject', 'scene', 'visual_style', 'framing_camera', 'lighting', 'must_include', 'avoid', 'aspect ratio'],
        anti_patterns: ['只堆高级感、电影感、氛围感而不写关键槽位', '主体、场景、布局、比例缺失'],
      }
    },
    {
      title: '优秀 prompt 常自带“失败约束”',
      principle: {
        id: 'failure-constraints-must-be-explicit',
        applies_to: ['poster-layout', 'infographic', 'ecommerce-conversion', 'ui-mockup', 'portrait-photo', 'character-sheet'],
        signals: ['avoid', '不要 AI 味', '不要塑料皮肤', '不要乱字', '不要背景抢主体'],
        anti_patterns: ['没有 avoid 层', '只讲想要什么，不讲绝对不要什么'],
      }
    },
    {
      title: '混合任务优先做结构拆解，再拼风格',
      principle: {
        id: 'decompose-structure-before-style-mixing',
        applies_to: ['social-post', 'ui-mockup', 'ecommerce-conversion', 'infographic', 'poster-layout'],
        signals: ['用途结构', '平台语法', 'layout hierarchy', '次风格'],
        anti_patterns: ['直接把多个风格词硬拼在一起', '先堆风格再想结构'],
      }
    },
    {
      title: 'clarify 只问会改变画面结果的问题',
      principle: {
        id: 'clarify-only-when-outcome-changes',
        applies_to: ['ui-mockup', 'ecommerce-conversion', 'infographic', 'poster-layout', 'portrait-photo', 'character-sheet', 'social-post'],
        signals: ['task type', 'layout', 'ratio', 'platform', 'style direction', 'consistency scope'],
        anti_patterns: ['为了完整而盘问所有细节', '低影响问题也打断用户'],
      }
    },
    {
      title: '新主题不等于无解',
      principle: {
        id: 'solve-new-themes-by-visual-problem-shape',
        applies_to: ['generic', 'poster-layout', 'infographic', 'ecommerce-conversion', 'ui-mockup', 'portrait-photo'],
        signals: ['visual task', 'core subject', 'scene', 'credibility detail', 'failure smells'],
        anti_patterns: ['模板库里没见过题材就放弃', '把模板当题材字典而不是求解器'],
      }
    }
  ];

  return specs
    .filter(({ principle }) => !existingIds.has(principle.id))
    .map(({ title, principle }) => {
      const section = byTitle.get(title);
      return {
        ...principle,
        title,
        summary: section?.summary || '',
        rawExcerpt: section?.body?.slice(0, 600) || '',
      };
    });
}

async function main() {
  for (const file of Object.values(promptMethodSourcePaths).concat([overlapMapFile])) {
    await access(file);
  }

  const templatesIndex = await readJson(promptMethodSourcePaths.templatesIndex);
  const promptTaxonomy = await readJson(promptMethodSourcePaths.promptTaxonomy);
  const principles = await readJson(promptMethodSourcePaths.principles);
  const principlesMd = await readFile(promptMethodSourcePaths.principlesMd, 'utf8');
  const clarifyMd = await readFile(promptMethodSourcePaths.clarifyRules, 'utf8');
  const referenceModeMd = await readFile(promptMethodSourcePaths.referenceImageMode, 'utf8');
  const overlapMap = await readJson(overlapMapFile);

  const entries = (templatesIndex.entries || []).map(buildPromptRecord);
  const compiledTemplates = Object.entries(overlapMap.templates || {}).map(([templateId, rule]) => {
    const curatedEntries = dedupeCuratedEntries(entries
      .map((entry) => ({ ...entry, score: scoreOverlap(entry, rule) }))
      .filter((entry) => passesOverlapRule(entry, rule, entry.score))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, rule.limit || 10));

    return {
      id: templateId,
      primaryTaskFamily: rule.primaryTaskFamily,
      secondaryTaskFamilies: rule.secondaryTaskFamilies || [],
      includeAny: rule.includeAny || [],
      excludeAny: rule.excludeAny || [],
      curatedEntries,
    };
  });

  const promptFragmentsIndex = {
    generatedAt: new Date().toISOString(),
    source: {
      promptMethodSourceRoot,
      templatesIndex: promptMethodSourcePaths.templatesIndex,
      overlapMap: 'data/prompt-engine/overlap-map.json',
      rule: 'project prompt-method source corpus into current canonical templates as exemplar-backed structural hints'
    },
    totalSourceEntries: templatesIndex.count || entries.length,
    templates: compiledTemplates,
  };

  const promptPrinciplesIndex = {
    generatedAt: new Date().toISOString(),
    source: {
      promptMethodSourceRoot,
      principles: promptMethodSourcePaths.principles,
      promptTaxonomy: promptMethodSourcePaths.promptTaxonomy,
      principlesMd: promptMethodSourcePaths.principlesMd,
    },
    families: promptTaxonomy.categories || [],
    principles: [...(principles.principles || []), ...buildSupplementalPrinciples(principlesMd, principles.principles || [])],
  };

  const clarifyRulesIndex = buildClarifyRules();
  clarifyRulesIndex.rawExcerpt = cleanText(clarifyMd).slice(0, 1000);

  const referenceModeIndex = buildReferenceModeContract(referenceModeMd);
  const routingIndex = await buildRoutingConfig();

  await mkdir(path.join(dataDir, 'prompt-engine'), { recursive: true });
  await writeFile(path.join(dataDir, 'prompt-engine', 'fragments.json'), `${JSON.stringify(promptFragmentsIndex, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dataDir, 'prompt-engine', 'principles.json'), `${JSON.stringify(promptPrinciplesIndex, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dataDir, 'prompt-engine', 'clarify-rules.json'), `${JSON.stringify(clarifyRulesIndex, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dataDir, 'prompt-engine', 'reference-mode.json'), `${JSON.stringify(referenceModeIndex, null, 2)}\n`, 'utf8');
  await writeFile(path.join(dataDir, 'prompt-engine', 'routing.json'), `${JSON.stringify(routingIndex, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    generated: [
      'data/prompt-engine/fragments.json',
      'data/prompt-engine/principles.json',
      'data/prompt-engine/clarify-rules.json',
      'data/prompt-engine/reference-mode.json',
      'data/prompt-engine/routing.json'
    ],
    templatesCovered: compiledTemplates.length,
    fragmentCounts: compiledTemplates.map((item) => ({ id: item.id, fragments: item.curatedEntries.length })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
