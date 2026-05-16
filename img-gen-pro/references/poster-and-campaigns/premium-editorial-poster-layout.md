# 高级编辑海报版式模板

本文件用于生成“单张完成度很高、版式驱动、可承接电影 / 时尚 / 文化 / 概念主题”的通用高级海报：

- premium editorial poster layout
- analog / handmade movie poster
- 高级单张主题海报
- 纹理、层级、裁切和版式驱动的完成图

特征：

- 单张 finished poster，不是展示板
- 强主视觉 + 明确标题层级
- 允许纸张、撕纸、网点、复印颗粒、错位印刷等模拟印刷质感
- 适合电影感、时尚感、文化感、概念感主题

## 适用范围

- 通用高级海报版式
- 电影 / 文化 / 主题活动海报
- 模拟印刷质感 poster
- 强版式、强纹理、强层级的单张完成图

## 何时使用

- 用户提到“poster layout / 主题海报 / 高级单张海报 / analog poster / ripped paper poster / halftone poster”
- 重点是海报整体的版式、层级、纸张和纹理完成度，而不是特定品牌系统或概念字体规则
- 希望输出是一张能直接传播的 poster，而不是 moodboard 或信息图

不要使用：

- 概念字体作为绝对主角（用 `typography-and-text-layout/conceptual-typography-poster.md`）
- 东方水墨双重曝光人物海报（用 `ink-double-exposure-character-poster.md`）
- 品牌产品主视觉（用 `brand-poster.md`）

## 缺失信息优先提问顺序

1. 海报主题 / 题材（电影 / 时尚 / 艺术 / 文化 / 活动）
2. 主视觉主体是什么
3. 标题 / 副标题 / 是否需要少量附文
4. 版式气质（居中 / 失衡裁切 / 对角构图 / top-heavy）
5. 纹理方向（撕纸 / 网点 / 颗粒 / 做旧纸）
6. 比例（默认 3:4 或 9:16）

## 主模板：高级编辑海报版式

📖 描述

生成一张单张完成度极高的高级主题海报，以版式结构、主视觉锚点、文字层级与模拟印刷质感共同驱动画面。

📝 提示词

```json
{
  "type": "Premium Editorial Poster Layout",
  "goal": "生成一张可直接传播的高级单张海报，强调版式层级、纹理完成度和主视觉冲击",
  "theme": {
    "topic": "{argument name=\"topic\" default=\"a poetic new-wave film poster\"}",
    "headline": "{argument name=\"headline\" default=\"main title\"}",
    "subheadline": "{argument name=\"subheadline\" default=\"optional short supporting line\"}"
  },
  "visual": {
    "hero_subject": "{argument name=\"hero subject\" default=\"a single dominant figure or object with strong silhouette\"}",
    "composition": "{argument name=\"composition\" default=\"vertical poster, top-heavy hierarchy, one strong focal anchor\"}",
    "texture_system": "{argument name=\"texture system\" default=\"aged cream paper, ripped paper edges, halftone dots, photocopy grain, slight ink bleed\"}",
    "palette": "{argument name=\"palette\" default=\"2-4 restrained colors with one expressive accent\"}"
  },
  "layout": {
    "title_rule": "title must remain readable and structurally integrated into the poster",
    "text_density": "minimal supporting text only",
    "finishing": "high-end print-like finishing, layered collage logic only when it supports hierarchy"
  },
  "constraints": {
    "must_keep": [
      "single finished poster only",
      "clear hierarchy between hero image, title, and supporting text",
      "texture must feel intentional rather than noisy",
      "the poster must feel editorial and premium"
    ],
    "avoid": [
      "turning the output into a board or mood sheet",
      "crowding the canvas with too many focal points",
      "using glossy ad aesthetics when analog editorial texture is desired",
      "making the title unreadable"
    ]
  }
}
```

### 参数策略

- 必问：主题、主视觉、标题
- 可默认：模拟印刷纹理、版式层级、克制色板
- 可随机：撕纸边缘位置、颗粒密度、局部裁切方式

### 自动补全策略

- 默认 single poster only
- 若用户给的是电影 / 艺术主题，自动偏 editorial + analog 纹理
- 若用户没给具体版式，默认 one strong focal anchor + top-heavy hierarchy

## 变体 1：极简现代版式

```json
{
  "type": "Minimal Editorial Poster Layout",
  "visual": { "texture_system": "minimal paper grain only" },
  "constraints": { "must_feel": "clean, modern, restrained" }
}
```

## 避免事项

- 不要把 generic poster 强行做成品牌广告
- 不要把纹理做成脏乱特效堆砌
- 不要让多个主体同时争抢主视觉
- 不要把信息量做成 infographic

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `poster-layout-system`
- Retrieval styles: `Poster`, `Brand`
- Retrieval scenes: `Tech`, `Commerce`, `Fashion`
- Curated example cases: `345`, `5`, `10`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=poster-layout-system]`
