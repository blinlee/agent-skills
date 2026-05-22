import { readFile } from 'node:fs/promises';
import path from 'node:path';

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function normalize(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function pickLabel(raw, fallback = '') {
  const text = String(raw || '');
  const emphasize = text.match(/(?:强调|包含|展示|包括|show|include)\s*[:：]?\s*(.+)$/i);
  if (emphasize) return emphasize[1].trim();
  return fallback;
}

function extractWeakTerms(raw) {
  const text = String(raw || '');
  const asciiSpecials = text.match(/\b[A-Z][A-Za-z0-9+-]{1,}\b/g) || [];
  const formulas = text.match(/[a-zA-ZΔ][a-zA-Z0-9Δ_]*\s*=\s*[^，。,.;；\s]+/g) || [];
  const quoted = [...text.matchAll(/[“"「]([^”"」]+)[”"」]/g)].map((match) => match[1]);
  return unique([...asciiSpecials, ...formulas, ...quoted]);
}

function baseBrief(rawQuery) {
  return {
    source: 'local-routing-brief',
    rawQuery,
    visualTaskType: 'generic_image',
    outputPurpose: 'general_visual',
    layoutIntent: 'single coherent image',
    styleIntent: [],
    routingQuery: normalize(rawQuery),
    contentPayload: {
      originalRequest: rawQuery,
      subject: rawQuery,
      mustInclude: [],
    },
    weakMatchTerms: extractWeakTerms(rawQuery),
    notes: [],
  };
}

function setRoute(brief, fields) {
  return {
    ...brief,
    ...fields,
    styleIntent: unique([...(brief.styleIntent || []), ...(fields.styleIntent || [])]),
    contentPayload: {
      ...brief.contentPayload,
      ...(fields.contentPayload || {}),
    },
    weakMatchTerms: unique([...(brief.weakMatchTerms || []), ...(fields.weakMatchTerms || [])]),
    notes: unique([...(brief.notes || []), ...(fields.notes || [])]),
  };
}

export function buildRoutingBrief(rawQuery) {
  const raw = String(rawQuery || '').trim();
  const text = normalize(raw);
  let brief = baseBrief(raw);

  const styleIntent = [];
  if (hasAny(text, [/白底|white background|净白/])) styleIntent.push('white background');
  if (hasAny(text, [/矢量|vector/])) styleIntent.push('clean vector');
  if (hasAny(text, [/学术|论文|期刊|顶刊|nature|science|chi|ieee|publication/])) styleIntent.push('academic publication');
  if (hasAny(text, [/暗色|dark/])) styleIntent.push('dark technical');
  if (hasAny(text, [/高端|premium|高级/])) styleIntent.push('premium restrained');
  brief.styleIntent = styleIntent;

  if (hasAny(text, [/直播|带货|商品卡|弹幕|评论区|live commerce|livestream/])) {
    brief = setRoute(brief, {
      visualTaskType: 'ui_mockup',
      outputPurpose: 'live_commerce_screen',
      layoutIntent: 'mobile live commerce interface screenshot',
      routingQuery: 'live commerce ui mockup mobile screenshot product card comments overlay',
    });
  } else if (hasAny(text, [/er\s*图|er diagram|实体关系|数据模型/])) {
    brief = setRoute(brief, {
      visualTaskType: 'er_diagram',
      outputPurpose: 'technical_diagram',
      layoutIntent: 'entity relationship data model diagram',
      routingQuery: 'technical er diagram data model entity relationship',
    });
  } else if (hasAny(text, [/网络拓扑|拓扑图|network topology|路由器|防火墙|交换机/])) {
    brief = setRoute(brief, {
      visualTaskType: 'network_topology',
      outputPurpose: 'technical_diagram',
      layoutIntent: 'network topology diagram',
      routingQuery: 'technical network topology diagram router firewall switch nodes',
    });
  } else if (hasAny(text, [/时序图|sequence diagram|调用流|lifeline|api\s*时序/])) {
    brief = setRoute(brief, {
      visualTaskType: 'sequence_diagram',
      outputPurpose: 'technical_diagram',
      layoutIntent: 'uml sequence diagram',
      routingQuery: 'technical uml sequence diagram lifeline call flow',
    });
  } else if (hasAny(text, [/流程图|决策图|flowchart|decision|分支|泳道/])) {
    brief = setRoute(brief, {
      visualTaskType: 'flowchart',
      outputPurpose: 'technical_diagram',
      layoutIntent: 'decision flowchart',
      routingQuery: 'technical flowchart decision diagram branch process',
    });
  } else if (hasAny(text, [/架构图|系统架构|技术架构|微服务|api gateway|harness|sandbox|agent loop|slam|多传感器融合/])) {
    const academicArchitecture = hasAny(text, [/学术|论文|期刊|顶刊|nature|science|chi|ieee|publication/]);
    brief = setRoute(brief, {
      visualTaskType: 'system_architecture',
      outputPurpose: academicArchitecture ? 'academic_figure' : 'technical_diagram',
      layoutIntent: 'system architecture component diagram',
      routingQuery: academicArchitecture
        ? 'technical system architecture diagram component boundary data flow academic paper figure clean vector white background'
        : 'technical system architecture diagram component boundary data flow',
    });
  } else if (hasAny(text, [/物理原理|基本原理|原理图|schematic|scientific schematic|实验装置|测距|公式|flight time|time of flight|single physical principle|物理过程/])) {
    brief = setRoute(brief, {
      visualTaskType: 'scientific_schematic',
      outputPurpose: hasAny(text, [/学术|论文|期刊|nature|science|ieee|publication/]) ? 'academic_figure' : 'scientific_explanation',
      layoutIntent: 'single scientific principle schematic with labeled components',
      routingQuery: 'academic scientific schematic single physical principle diagram clean vector white background labeled formula',
      weakMatchTerms: extractWeakTerms(raw),
    });
  } else if (hasAny(text, [/机理|机制|反应路径|催化|酶|通路|pathway|reaction mechanism|catalysis|腐蚀|老化|退化|相变/])) {
    brief = setRoute(brief, {
      visualTaskType: 'mechanism_diagram',
      outputPurpose: hasAny(text, [/学术|论文|期刊|nature|science|publication/]) ? 'academic_figure' : 'scientific_explanation',
      layoutIntent: 'academic mechanism pathway diagram',
      routingQuery: 'academic mechanism diagram reaction pathway causal process clean vector white background',
    });
  } else if (hasAny(text, [/a股|行情|指数|板块|券商|研报|市场快照|market snapshot/])) {
    brief = setRoute(brief, {
      visualTaskType: 'report_page',
      outputPurpose: 'financial_research_report',
      layoutIntent: 'market snapshot report page',
      routingQuery: 'financial research report page visual report market snapshot securities dashboard white background readable numbers',
    });
  } else if (hasAny(text, [/品牌识别|brand identity|vi|logo|字体规范/])) {
    brief = setRoute(brief, {
      visualTaskType: 'brand_identity_board',
      outputPurpose: 'brand_system_design',
      layoutIntent: 'brand identity board',
      routingQuery: 'brand identity system board logo palette typography packaging',
    });
  } else if (hasAny(text, [/触点|落地视觉|touchpoint|rollout|杯套|外卖袋|门店招牌|小程序/])) {
    brief = setRoute(brief, {
      visualTaskType: 'brand_touchpoint_board',
      outputPurpose: 'brand_rollout_design',
      layoutIntent: 'multi touchpoint brand rollout board',
      routingQuery: 'brand touchpoint rollout system board packaging signage social mini app',
    });
  } else if (hasAny(text, [/标题字|字体|typography|文字做主角|字是主角/])) {
    brief = setRoute(brief, {
      visualTaskType: 'typography_poster',
      outputPurpose: 'poster_layout',
      layoutIntent: 'conceptual typography poster',
      routingQuery: 'conceptual typography poster headline text as main subject',
    });
  } else if (hasAny(text, [/参考这两张|多参考|放进|放到另一个场景|光线要统一|multi reference|background swap|composite/])) {
    brief = setRoute(brief, {
      visualTaskType: 'multi_reference_composition',
      outputPurpose: 'image_edit',
      layoutIntent: 'composite subject into target scene',
      routingQuery: 'multi reference composition background swap scene transfer unified lighting',
    });
  } else if (hasAny(text, [/无拉链|没有拉链|无缝线|不可能产品|no zipper|no seam|约束驱动/])) {
    brief = setRoute(brief, {
      visualTaskType: 'concept_product_visual',
      outputPurpose: 'product_concept',
      layoutIntent: 'constraint driven impossible concept product poster',
      routingQuery: 'constraint driven impossible concept product poster premium product visual',
    });
  } else if (hasAny(text, [/落地页|首屏|商品主图|产品主图|buy now|转化|serum|skincare|电商/])) {
    brief = setRoute(brief, {
      visualTaskType: 'commerce_visual',
      outputPurpose: 'ecommerce_conversion',
      layoutIntent: 'ecommerce marketing board or landing page hero',
      routingQuery: 'ecommerce conversion marketing board landing page hero product benefits cta',
    });
  } else if (hasAny(text, [/写上|写在|物体表面|香蕉皮|surface text|text on/])) {
    brief = setRoute(brief, {
      visualTaskType: 'text_on_object',
      outputPurpose: 'scene_illustration',
      layoutIntent: 'realistic text placed on object surface',
      routingQuery: 'text on object surface realistic photo readable lettering',
    });
  } else if (hasAny(text, [/梗图|meme|viral|恶搞|玩梗/])) {
    brief = setRoute(brief, {
      visualTaskType: 'meme_visual',
      outputPurpose: 'social_post',
      layoutIntent: 'viral meme image',
      routingQuery: 'meme viral social image parody',
    });
  } else if (hasAny(text, [/lookbook|穿搭|pinterest|拎包|袖子|fashion/])) {
    brief = setRoute(brief, {
      visualTaskType: 'fashion_lookbook',
      outputPurpose: 'fashion_visual',
      layoutIntent: 'fashion lookbook pose',
      routingQuery: 'fashion lookbook pose pinterest outfit editorial',
    });
  } else if (hasAny(text, [/信息图|infographic|explainer|知识卡片|模块/])) {
    brief = setRoute(brief, {
      visualTaskType: 'infographic',
      outputPurpose: 'explanation',
      layoutIntent: 'modular explainer infographic',
      routingQuery: 'infographic explainer modular information design readable labels',
    });
  }

  brief.contentPayload = {
    ...brief.contentPayload,
    subject: raw,
    mustInclude: unique([pickLabel(raw), ...extractWeakTerms(raw)]).filter(Boolean),
  };
  if (brief.routingQuery === normalize(raw)) {
    brief.notes.push('No specialized routing pattern matched; using normalized request as routing query.');
  } else {
    brief.notes.push('Routing query intentionally omits or weakens concrete content terms that should fill the prompt after template selection.');
  }
  return brief;
}

export async function loadRoutingBrief(rawJson, filePath, rawQuery) {
  if (rawJson) return JSON.parse(rawJson);
  if (filePath) return JSON.parse(await readFile(path.resolve(filePath), 'utf8'));
  return buildRoutingBrief(rawQuery);
}
