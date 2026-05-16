# 品牌触点系统视觉板模板

本文件用于生成“同一品牌在多个触点上的统一视觉落地板”：

- brand touchpoint board
- campaign rollout preview
- 多触点品牌系统板
- 产品 + 包装 + 社媒 + 门店 / app 的统一展示板

特征：

- 一张大板里展示多个落地触点
- 必须有一个 hero scene 作为情绪锚点
- 其他触点围绕统一配色、字体、材质和摄影语言展开
- 更强调 rollout 与 campaign consistency，而不是纯 logo / VI 摘要

## 适用范围

- 多触点品牌视觉板
- campaign rollout preview
- 品牌落地预览页
- 统一风格的品牌应用展示板

## 何时使用

- 用户提到“品牌触点 / 多触点 / touchpoint board / rollout / brand application board”
- 重点是多个实际应用场景共享同一视觉系统
- 希望看到 hero product / hero scene + 包装 / 社媒 / 标牌 / 物料的统一出现

不要使用：

- 单纯品牌识别总结（用 `brand-identity-board.md`）
- 吉祥物周边展示（用 `character-merch-board.md`）
- 单个产品广告主图（用 `product-visuals/lifestyle-product-scene.md`）

## 缺失信息优先提问顺序

1. 品牌名 + 品牌定位
2. 需要出现的触点清单
3. hero scene 是什么（饮品 / 包装 / 人物 / 门店角落 / app 首屏）
4. 统一色板与字体气质
5. 画面是更极简还是更生活方式导向
6. 比例（默认 3:4）

## 主模板：多触点品牌系统视觉板

📖 描述

生成一张同时展示 hero scene 与多个品牌触点的统一视觉板，重点是 rollout consistency，而不是单一 logo 说明页。

📝 提示词

```json
{
  "type": "Brand Touchpoint System Board",
  "goal": "生成一张完整展示品牌在多个触点上统一落地效果的高级视觉板",
  "brand": {
    "name": "{argument name=\"brand name\" default=\"MATCHA MODE\"}",
    "positioning": "{argument name=\"positioning\" default=\"modern lifestyle matcha brand\"}",
    "tone": "{argument name=\"tone\" default=\"clean, tactile, premium, softly editorial\"}"
  },
  "hero_scene": {
    "subject": "{argument name=\"hero subject\" default=\"a premium matcha drink in a ceramic cup with refined foam texture\"}",
    "placement": "center or upper-center as the emotional anchor",
    "lighting": "soft premium studio-meets-lifestyle lighting"
  },
  "touchpoints": {
    "items": [
      "{argument name=\"touchpoint 1\" default=\"packaging box\"}",
      "{argument name=\"touchpoint 2\" default=\"paper cup / label\"}",
      "{argument name=\"touchpoint 3\" default=\"social post / story card\"}",
      "{argument name=\"touchpoint 4\" default=\"shop sign or countertop scene\"}",
      "{argument name=\"touchpoint 5\" default=\"membership card or app screen\"}"
    ],
    "layout_rule": "hero scene first, remaining touchpoints arranged as a coherent system board with consistent spacing"
  },
  "system": {
    "palette": "{argument name=\"palette\" default=\"matcha green, warm cream, charcoal, one accent gold\"}",
    "typography": "{argument name=\"typography\" default=\"one primary sans + one restrained display accent\"}",
    "materials": "ceramic, matte paper, subtle fiber texture, brushed metal only if relevant"
  },
  "constraints": {
    "must_keep": [
      "all touchpoints must look like the same brand system",
      "hero scene must remain the emotional anchor",
      "panel density must stay readable",
      "the board must feel premium and rollout-ready"
    ],
    "avoid": [
      "mixing unrelated campaign aesthetics",
      "using too many colors or font personalities",
      "treating every panel as a separate moodboard",
      "letting one touchpoint break the material language"
    ]
  }
}
```

### 参数策略

- 必问：品牌名、hero scene、触点清单
- 可默认：统一色板、版面节奏、材质语言
- 可随机：局部 mockup 朝向、小面积留白、辅助标签位置

### 自动补全策略

- 默认一个 hero 场景 + 4-5 个触点，不做无限拼贴
- 若用户只给品牌气质，不给触点，优先补包装 / 社媒 / 标牌 / app 四类高代表性触点
- 自动保持同一配色和字体逻辑，防止“每块像不同品牌”

## 变体 1：重产品轻环境

```json
{
  "type": "Product-led Touchpoint Board",
  "hero_scene": { "subject": "product-first hero shot" },
  "constraints": { "must_feel": "more commercial, less ambient" }
}
```

## 避免事项

- 不要把它做成普通 VI summary
- 不要让不同触点像来自不同品牌
- 不要过度拼贴成 moodboard
- 不要在没有 hero 锚点时平均分配所有面板权重

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `brand-touchpoint-board`
- Retrieval styles: `Brand`, `Product`
- Retrieval scenes: `Commerce`, `Social`
- Curated example cases: `362`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=brand-touchpoint-board]`
