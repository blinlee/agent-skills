import fs from 'node:fs';
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.dirname(path.dirname(__dirname));
const dataDir = path.join(skillRoot, 'data');
const TAXONOMY_SOURCE_CANDIDATES = [
  path.join(skillRoot, 'sources', 'taxonomy-library'),
  path.join('/home/ubuntu/.openclaw/.workspace/inbox/repos/awesome-gpt-image-2'),
];

function resolveExistingDir(candidates, label) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to resolve ${label} from candidates: ${candidates.join(', ')}`);
}

const taxonomySourceDir = resolveExistingDir(TAXONOMY_SOURCE_CANDIDATES, 'taxonomy source');
const CJK_STOPGRAMS = new Set([
  "生成","一张","一个","一组","风格","风格的","包含","整体","画面","要求","输入","输出","模板","背景","主体","设计","图片","内容","结构","视觉","说明","需要","不要","使用","可以","用于","默认","参数","信息","效果","感觉","元素",
  "生成一","成一张","生成一张","设计一","计一张","设计一张","整体视","体视觉","整体视觉"
]);
const SPECIAL_TEMPLATE_METADATA = {
  "city-creative-font": {
    title: { en: "City Creative Font", zh: "城市创意字体" },
    category: "Posters & Typography",
    styles: ["Poster"],
    scenes: ["Creative"],
    tags: ["city", "typography", "font", "creative font", "城市", "字体"],
    useWhen: { en: "When the city name itself should become the main visual structure.", zh: "当城市名本身要成为主视觉结构时。" },
    guidance: { en: "Keep the city name readable and concept-led.", zh: "让城市名可读且承担概念主视觉。" },
    pitfalls: { en: ["Do not turn the title into abstract unreadable word art."], zh: ["不要把标题做成不可读的抽象字效。"] },
    anchor: "tpl-poster",
    cover: "/images/category-covers/poster.jpg",
    exampleCases: []
  },
  "fashion-lookbook-pose": {
    title: { en: "Fashion Lookbook Pose", zh: "时尚姿态 Lookbook" },
    category: "Characters & People",
    styles: ["Character", "Photography"],
    scenes: ["Fashion"],
    tags: ["fashion", "lookbook", "pose", "pinterest", "穿搭", "姿态"],
    useWhen: { en: "When outfit presentation and pose direction matter more than generic portraiture.", zh: "当穿搭展示与姿态引导比通用人像更重要时。" },
    guidance: { en: "Bias toward editorial styling, garment drape, and pose readability.", zh: "优先强调 editorial 风格、服装垂坠和姿态可读性。" },
    pitfalls: { en: ["Do not collapse into a generic portrait."], zh: ["不要退化成通用人像。"] },
    anchor: "tpl-character",
    cover: "/images/category-covers/character.jpg",
    exampleCases: []
  },
  "impossible-concept-product": {
    title: { en: "Impossible Concept Product", zh: "不可能约束概念产品" },
    category: "Products & E-commerce",
    styles: ["Product", "Poster"],
    scenes: ["Creative", "Commerce"],
    tags: ["impossible", "constraint-driven", "concept product", "no zipper", "无拉链", "概念产品"],
    useWhen: { en: "When the selling idea is a hard physical constraint or impossible product logic.", zh: "当卖点本身是硬约束或不可能产品逻辑时。" },
    guidance: { en: "Make the constraint the hero, while preserving commercial plausibility.", zh: "让约束成为主角，同时保持商业可信度。" },
    pitfalls: { en: ["Do not drift into a normal product ad."], zh: ["不要漂回普通产品海报。"] },
    anchor: "tpl-product",
    cover: "/images/category-covers/product.jpg",
    exampleCases: []
  },
  "meme-viral-content": {
    title: { en: "Meme & Viral Content", zh: "梗图与传播图" },
    category: "Scenes & Storytelling",
    styles: ["Illustration", "Poster"],
    scenes: ["Creative", "Social"],
    tags: ["meme", "viral", "parody", "satire", "梗图", "传播"],
    useWhen: { en: "When the image must land a joke or spread quickly on social platforms.", zh: "当画面要承担梗点或社媒传播时。" },
    guidance: { en: "Favor instant legibility and platform-native shareability.", zh: "优先一眼读懂和平台传播性。" },
    pitfalls: { en: ["Do not overcomplicate the joke structure."], zh: ["不要把梗结构做得太复杂。"] },
    anchor: "tpl-scene",
    cover: "/images/category-covers/scene.jpg",
    exampleCases: []
  },
  "multi-reference-composition": {
    title: { en: "Multi-Reference Composition", zh: "多参考图融合" },
    category: "Other Use Cases",
    styles: ["Photography"],
    scenes: ["Creative"],
    tags: ["multi reference", "composite", "background swap", "光线统一", "融合", "合成"],
    useWhen: { en: "When multiple reference images must be fused into one coherent result.", zh: "当多张参考图要被融合成一个统一结果时。" },
    guidance: { en: "Prioritize scale, perspective, contact, and light matching over collage energy.", zh: "优先保证尺度、透视、接触关系和光线统一，而不是拼贴感。" },
    pitfalls: { en: ["Do not treat it as loose collage."], zh: ["不要把它当松散拼贴。"] },
    anchor: "tpl-other",
    cover: "/images/category-covers/other.jpg",
    exampleCases: []
  },
  "text-on-objects": {
    title: { en: "Text on Objects", zh: "物体表面文字" },
    category: "Scenes & Storytelling",
    styles: ["Photography"],
    scenes: ["Creative", "Tech"],
    tags: ["text on object", "surface text", "screen content", "物体表面文字", "香蕉写字", "曲面文字"],
    useWhen: { en: "When exact readable text must live on a real object surface or display.", zh: "当精确可读文字必须出现在真实物体表面或屏幕上时。" },
    guidance: { en: "Bias toward material adhesion, curvature realism, and exact text fidelity.", zh: "优先强调材质贴合、曲面真实感和文字准确度。" },
    pitfalls: { en: ["Do not render the text as a floating flat overlay."], zh: ["不要把文字做成漂浮的平面贴图。"] },
    anchor: "tpl-scene",
    cover: "/images/category-covers/scene.jpg",
    exampleCases: []
  }
};

function mergeSpecialTemplates(styleLibrary) {
  const existing = new Set((styleLibrary.templates || []).map((item) => item.id));
  const additions = [];
  for (const [id, meta] of Object.entries(SPECIAL_TEMPLATE_METADATA)) {
    if (existing.has(id)) continue;
    additions.push({ id, ...meta });
  }
  return { ...styleLibrary, templates: [...(styleLibrary.templates || []), ...additions] };
}

const TEMPLATE_VARIANT_BINDINGS = {
  "ui-screenshot-system": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）", "截图生成模板", "直播界面模板"],
  "infographic-engine": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "scientific-scale-diagram": ["尺度缩放科学信息图模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "poster-layout-system": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "sports-campaign-poster": ["运动商业 Campaign 模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "conceptual-typography-poster": ["概念字体海报模板", "中文版：概念字体海报模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "ink-double-exposure-poster": ["水墨双重曝光人物海报模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "nature-science-poster": ["自然科普海报模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "product-commerce-visual": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "personalized-beauty-report": ["个人化美妆推荐报告模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "brand-identity-package": ["常规模板", "完整品牌身份包模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "brand-touchpoint-board": ["品牌触点系统视觉板模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "architecture-space": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "realistic-photography": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "street-accident-moment": ["街头意外瞬间写实摄影模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "illustration-art-style": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "character-design-sheet": ["常规模板", "动作分解参考表模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "3d-collectible-toy": ["参考图转 3D 收藏玩具模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "scene-storytelling": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "history-classical-themes": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "document-publishing": ["常规模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "concept-product-breakdown": ["概念产品研发拆解板模板", "JSON 进阶模板（推荐给 Agent 调用）"],
  "city-creative-font": ["城市创意字体模板"],
  "fashion-lookbook-pose": ["时尚姿态 lookbook 模板"],
  "impossible-concept-product": ["不可能约束概念产品模板"],
  "meme-viral-content": ["梗图 / viral content 模板"],
  "multi-reference-composition": ["多参考图融合模板"],
  "text-on-objects": ["物体表面文字模板"],
};

function unique(items) {
  return [...new Set(items)];
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function indexBy(items, key) {
  const map = new Map();
  for (const item of items) map.set(item[key], item);
  return map;
}

function cleanText(value = "") {
  return String(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

function extractAsciiTokens(text) {
  const ascii = (normalizeText(text).match(/[a-z0-9][a-z0-9+-]*/g) || [])
    .flatMap((token) => token.split(/[+-]/g))
    .filter((token) => token.length >= 2);
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

function labelOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.en || value.zh || "";
}

function cleanLine(line) {
  return String(line || "").replace(/^[-*]\s*/, "").trim();
}

function caseIdsFromTemplates(templates) {
  const ids = [];
  for (const template of templates) {
    for (const id of template.exampleCases || []) ids.push(id);
  }
  return unique(ids);
}

function linkedTemplateIds(caseId, templates) {
  return templates.filter((template) => (template.exampleCases || []).includes(caseId)).map((template) => template.id);
}

function splitVariantBlocks(body) {
  const lines = body.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\*\*(.+?)\*\*$/.test(trimmed)) {
      if (current) blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }

  if (current) blocks.push(current.join("\n"));
  return blocks;
}

function parseVariantBlock(block) {
  const lines = block.split(/\r?\n/);
  const heading = lines[0]?.trim().match(/^\*\*(.+?)\*\*$/);
  if (!heading) return null;

  const label = heading[1].trim();
  const noteLines = [];
  const bulletLines = [];
  const codeBlocks = [];
  let i = 1;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      const format = trimmed.slice(3).trim() || "text";
      const codeLines = [];
      i += 1;
      while (i < lines.length) {
        const inner = lines[i];
        const innerTrimmed = inner.trim();
        if (innerTrimmed.startsWith("```")) {
          i += 1;
          break;
        }
        if (/^\*\*(.+?)\*\*$/.test(innerTrimmed)) break;
        codeLines.push(inner);
        i += 1;
      }
      codeBlocks.push({ format, prompt: cleanText(codeLines.join("\n")) });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) bulletLines.push(cleanLine(trimmed));
    else noteLines.push(line);
    i += 1;
  }

  return {
    label,
    notes: cleanText(noteLines.join("\n")),
    bullets: unique(bulletLines.filter(Boolean)),
    codeBlocks: codeBlocks.filter((blockItem) => blockItem.prompt),
  };
}

function variantsForTemplate(templateId, section) {
  const preferred = TEMPLATE_VARIANT_BINDINGS[templateId];
  if (!preferred?.length) return section.variants;
  const preferredSet = new Set(preferred);
  const filtered = section.variants.filter((variant) => preferredSet.has(variant.label));
  return filtered.length ? filtered : section.variants;
}

function parseTemplateSections(text) {
  const sections = [];
  const regex = /<a name="(tpl-[^"]+)"><\/a>\s*\n\s*###\s+([^\n]+)\n([\s\S]*?)(?=\n<a name="tpl-[^"]+"><\/a>|$)/g;
  for (const match of text.matchAll(regex)) {
    const [, anchor, sectionTitle, body] = match;
    const variants = [];
    const pitfalls = [];

    for (const block of splitVariantBlocks(body)) {
      const parsed = parseVariantBlock(block);
      if (!parsed) continue;

      if (parsed.label.includes("避坑指南")) {
        pitfalls.push(...parsed.bullets);
        continue;
      }

      const primaryCode = parsed.codeBlocks[0] || { format: "text", prompt: "" };
      const prompt = primaryCode.prompt;
      const notes = parsed.notes;
      if (!prompt && !notes) continue;
      variants.push({
        label: parsed.label,
        format: primaryCode.format,
        notes,
        prompt,
      });
    }

    sections.push({ anchor, sectionTitle: cleanText(sectionTitle), variants, pitfalls: unique(pitfalls) });
  }
  return sections;
}

function scoreCaseCandidate(caseItem, template) {
  const caseStyles = new Set(caseItem.styles || []);
  const caseScenes = new Set(caseItem.scenes || []);
  let score = 0;
  if (caseItem.category === template.category) score += 6;
  for (const style of template.styles || []) if (caseStyles.has(style)) score += 4;
  for (const scene of template.scenes || []) if (caseScenes.has(scene)) score += 3;

  const haystacks = [caseItem.title, caseItem.promptPreview, caseItem.prompt].map(normalizeText).join(" \n ");
  for (const token of extractAsciiTokens(`${template.id} ${labelOf(template.title)} ${(template.tags || []).join(" ")}`)) {
    if (haystacks.includes(token)) score += 1;
  }
  return score;
}


const SPECIAL_TEMPLATE_ADDITIONS = {
  "city-creative-font": {
    sectionTitle: "海报与排版",
    variants: [{ label: "城市创意字体模板", format: "text", notes: "", prompt: "Create a city-name-led typography poster where the city name itself becomes the main visual architecture, with local cultural cues embedded into the letterforms, strong readability, premium poster finish, and minimal supporting elements." }],
    pitfalls: ["城市名必须可读且是主视觉，不要变成抽象字效。"]
  },
  "fashion-lookbook-pose": {
    sectionTitle: "人物与角色",
    variants: [{ label: "时尚姿态 lookbook 模板", format: "text", notes: "", prompt: "Create a premium fashion lookbook pose image with Pinterest/editorial styling, one clear model pose, outfit-led composition, believable garment drape, and clean photographic direction." }],
    pitfalls: ["先锁姿态与穿搭展示目标，不要退化成通用人像。"]
  },
  "impossible-concept-product": {
    sectionTitle: "商品与电商",
    variants: [{ label: "不可能约束概念产品模板", format: "text", notes: "", prompt: "Design a premium concept product image driven by a hard physical constraint, such as no zipper, no seam, or impossible closure logic, while still making the product look believable, luxurious, and commercially presentable." }],
    pitfalls: ["约束本身是主卖点，要写清不可能条件，不要退化成普通产品海报。"]
  },
  "meme-viral-content": {
    sectionTitle: "场景与叙事",
    variants: [{ label: "梗图 / viral content 模板", format: "text", notes: "", prompt: "Create a meme-ready viral visual with one instantly legible joke premise, fast-read composition, strong emotional contrast, and platform-native shareability." }],
    pitfalls: ["梗点必须一眼看懂，不要做成复杂说明海报。"]
  },
  "multi-reference-composition": {
    sectionTitle: "编辑工作流",
    variants: [{ label: "多参考图融合模板", format: "text", notes: "", prompt: "Fuse elements from multiple reference images into one coherent scene, preserving identity where needed, matching lighting, perspective, scale, and contact realism across all combined elements." }],
    pitfalls: ["核心不是拼贴，而是光线、尺度、透视统一。"]
  },
  "text-on-objects": {
    sectionTitle: "场景与叙事",
    variants: [{ label: "物体表面文字模板", format: "text", notes: "", prompt: "Render exact readable text on a real object surface or display, with believable material adhesion, curvature, lighting, and photographic realism." }],
    pitfalls: ["文字必须服从表面透视和材质，不要像后贴平面字幕。"]
  }
};

function enrichTemplateWithSpecialAddition(template, section) {
  const addition = SPECIAL_TEMPLATE_ADDITIONS[template.id];
  if (!addition) return section;
  return {
    anchor: template.anchor,
    sectionTitle: section?.sectionTitle || addition.sectionTitle,
    variants: [...(section?.variants || []), ...addition.variants],
    pitfalls: unique([...(section?.pitfalls || []), ...(addition.pitfalls || [])]),
  };
}

function buildPromptIntelligenceIndex(styleLibrary, templateSections) {
  const sectionMap = new Map(templateSections.map((section) => [section.anchor, section]));
  return {
    generatedAt: new Date().toISOString(),
    source: {
      taxonomySource: path.join(taxonomySourceDir, 'data', 'style-library.json'),
      templateCatalog: path.join(taxonomySourceDir, 'docs', 'templates.md'),
      rule: 'retain category-organized prompt bodies without turning them into a parallel authoring surface'
    },
    sections: templateSections,
    templates: styleLibrary.templates.map((template) => {
      const baseSection = sectionMap.get(template.anchor);
      const section = enrichTemplateWithSpecialAddition(template, baseSection);
      if (!section) throw new Error(`No prompt section found for anchor ${template.anchor} (${template.id})`);
      return {
        id: template.id,
        anchor: template.anchor,
        sectionTitle: section.sectionTitle,
        category: template.category,
        promptSource: `template-catalog#${template.anchor}`,
        variants: variantsForTemplate(template.id, section),
        pitfalls: section.pitfalls,
        exampleCases: template.exampleCases || [],
        variantProjection: TEMPLATE_VARIANT_BINDINGS[template.id] || [],
      };
    })
  };
}

function buildPromptCorpusIndex(styleLibrary, casesPayload) {
  const templates = styleLibrary.templates || [];
  return {
    generatedAt: new Date().toISOString(),
    source: {
      caseLibrary: path.join(taxonomySourceDir, 'data', 'cases.json'),
      taxonomySource: path.join(taxonomySourceDir, 'data', 'style-library.json'),
      rule: 'exact example cases first, then category/style/scene candidate linking'
    },
    totalCases: casesPayload.cases.length,
    cases: casesPayload.cases.map((item) => {
      const exactTemplateIds = linkedTemplateIds(item.id, templates);
      const candidateTemplates = templates
        .map((template) => ({ id: template.id, score: scoreCaseCandidate(item, template) }))
        .filter((candidate) => candidate.score >= 8 && !exactTemplateIds.includes(candidate.id))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, 6);
      return {
        id: item.id,
        title: item.title,
        category: item.category,
        styles: item.styles || [],
        scenes: item.scenes || [],
        featured: item.featured || false,
        promptPreview: item.promptPreview || "",
        prompt: item.prompt || "",
        sourceLabel: item.sourceLabel || "",
        sourceUrl: item.sourceUrl || "",
        githubUrl: item.githubUrl || "",
        exactTemplateIds,
        candidateTemplates,
      };
    })
  };
}

async function main() {
  const styleLibraryRaw = await readJson(path.join(taxonomySourceDir, 'data', 'style-library.json'));
  const styleLibrary = mergeSpecialTemplates(styleLibraryRaw);
  const casesPayload = await readJson(path.join(taxonomySourceDir, 'data', 'cases.json'));
  const crosswalk = await readJson(path.join(dataDir, 'template-crosswalk.json'));
  const templatesDoc = await readFile(path.join(taxonomySourceDir, 'docs', 'templates.md'), 'utf8');

  ensureArray(styleLibrary.categories, "styleLibrary.categories");
  ensureArray(styleLibrary.styles, "styleLibrary.styles");
  ensureArray(styleLibrary.scenes, "styleLibrary.scenes");
  ensureArray(styleLibrary.templates, "styleLibrary.templates");
  ensureArray(casesPayload.cases, "casesPayload.cases");

  const caseMap = indexBy(casesPayload.cases, "id");
  const missingTargets = [];
  for (const [templateId, mapping] of Object.entries(crosswalk.templates)) {
    for (const relative of mapping.canonicalTargets || []) {
      const full = path.join(skillRoot, relative);
      try {
        await readFile(full, "utf8");
      } catch {
        missingTargets.push(`${templateId} -> ${relative}`);
      }
    }
  }
  if (missingTargets.length) {
    throw new Error(`Missing canonical target files:\n${missingTargets.join("\n")}`);
  }

  const promptSections = parseTemplateSections(templatesDoc);
  const promptIntelligenceIndex = buildPromptIntelligenceIndex(styleLibrary, promptSections);
  const promptCorpusIndex = buildPromptCorpusIndex(styleLibrary, casesPayload);

  const retrievalIndex = {
    generatedAt: new Date().toISOString(),
    source: {
      crosswalk: 'data/template-crosswalk.json',
      promptIntelligence: 'data/prompt-intelligence-index.json',
      promptCorpus: 'data/prompt-corpus-index.json',
      rule: 'category -> style -> scene -> exampleCases'
    },
    schemaBoundary: {
      hardCastAllowed: false,
      taxonomy: 'metadata/index schema + category-organized prompt corpus',
      templates: 'prompt-instance markdown + JSON skeleton'
    },
    categories: styleLibrary.categories,
    styles: styleLibrary.styles,
    scenes: styleLibrary.scenes,
    templates: styleLibrary.templates.map((template) => {
      const mapping = crosswalk.templates[template.id] || { confidence: 'unmapped', canonicalTargets: [] };
      return {
        id: template.id,
        title: template.title,
        category: template.category,
        styles: template.styles || [],
        scenes: template.scenes || [],
        tags: template.tags || [],
        useWhen: template.useWhen || null,
        guidance: template.guidance || null,
        pitfalls: template.pitfalls || null,
        exampleCases: template.exampleCases || [],
        promptSource: `data/prompt-intelligence-index.json#templates[id=${template.id}]`,
        promptCorpusSource: `data/prompt-corpus-index.json#cases[*]`,
        templateSource: {
          anchor: template.anchor,
          cover: template.cover,
          templateDocument: styleLibrary.templateDocument
        },
        mappingConfidence: mapping.confidence,
        canonicalTargets: mapping.canonicalTargets || []
      };
    })
  };

  const curatedCaseIds = caseIdsFromTemplates(styleLibrary.templates);
  const curatedCaseIndex = {
    generatedAt: new Date().toISOString(),
    source: {
      taxonomySource: path.join(taxonomySourceDir, 'data', 'style-library.json'),
      caseLibrary: path.join(taxonomySourceDir, 'data', 'cases.json'),
      selectionRule: 'unique example cases referenced by taxonomy templates'
    },
    totalCases: curatedCaseIds.length,
    cases: curatedCaseIds.map((id) => {
      const item = caseMap.get(id);
      if (!item) throw new Error(`Missing case ${id} in taxonomy source cases.json`);
      const promptCase = promptCorpusIndex.cases.find((candidate) => candidate.id === id);
      return {
        id: item.id,
        title: item.title,
        category: item.category,
        styles: item.styles || [],
        scenes: item.scenes || [],
        featured: item.featured || false,
        promptPreview: item.promptPreview || "",
        prompt: item.prompt || "",
        sourceLabel: item.sourceLabel || "",
        sourceUrl: item.sourceUrl || "",
        githubUrl: item.githubUrl || "",
        linkedTemplateIds: linkedTemplateIds(id, styleLibrary.templates),
        candidateTemplates: promptCase?.candidateTemplates || []
      };
    })
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "retrieval-index.json"), JSON.stringify(retrievalIndex, null, 2) + "\n", "utf8");
  await writeFile(path.join(dataDir, "case-index.json"), JSON.stringify(curatedCaseIndex, null, 2) + "\n", "utf8");
  await writeFile(path.join(dataDir, "prompt-intelligence-index.json"), JSON.stringify(promptIntelligenceIndex, null, 2) + "\n", "utf8");
  await writeFile(path.join(dataDir, "prompt-corpus-index.json"), JSON.stringify(promptCorpusIndex, null, 2) + "\n", "utf8");

  console.log(JSON.stringify({
    ok: true,
    templates: retrievalIndex.templates.length,
    curatedCases: curatedCaseIndex.totalCases,
    promptSections: promptSections.length,
    promptCorpusCases: promptCorpusIndex.totalCases,
    outputs: [
      "data/retrieval-index.json",
      "data/case-index.json",
      "data/prompt-intelligence-index.json",
      "data/prompt-corpus-index.json"
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
