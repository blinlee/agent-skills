# 概念字体海报模板

本文件用于生成“标题文字本身就是主视觉结构”的高级概念字体海报：

- conceptual typography poster
- 标题即主视觉海报
- premium type-first poster
- 人像 / 物体 / 场景与字形深度互动的海报

特征：

- 只做一张 finished poster，不做 moodboard
- 标题必须可读且拼写完全正确
- 字形不是默认字体，而是被概念化设计过的视觉主体
- 图像元素必须服务标题含义，而不是摆在旁边装饰

## 适用范围

- 概念字体海报
- 标题主视觉海报
- 高级 type-first poster
- 需要“文字 + 图像互动”的编辑海报

## 何时使用

- 用户提到“conceptual typography / 概念字体海报 / 标题即主视觉 / type-first poster”
- 重点是标题含义、字形设计和视觉隐喻
- 希望海报像高级编辑设计，而不是普通大字 banner

不要使用：

- 纯 slogan 大字安全排版（用 `title-safe-poster.md`）
- 杂志封面式排版（用 `editorial-cover.md`）
- 品牌产品主海报（用 `poster-and-campaigns/brand-poster.md`）

## 缺失信息优先提问顺序

1. 精确标题（必须锁死拼写）
2. 标题的情绪 / 含义 / 隐喻方向
3. 是否需要人物 / 物体 / 风景与字形互动
4. 调色板（限制在 4-6 色）
5. 比例（默认 3:4 或 9:16）
6. 是否允许极少量副标题 / 小字

## 主模板：概念字体海报

📖 描述

生成一张标题绝对主导、字形经过概念化设计、并与人物或物体形成深度互动的高级编辑海报。

📝 提示词

```json
{
  "type": "Conceptual Typography Poster",
  "goal": "生成一张 finished premium conceptual typography poster，让标题本身成为主视觉结构",
  "headline": {
    "text": "{argument name=\"headline\" default=\"BEYOND STARS\"}",
    "rule": "must remain exactly spelled, huge, readable, and structurally dominant"
  },
  "concept": {
    "meaning": "{argument name=\"meaning\" default=\"a feeling of crossing the threshold between human ambition and the unknown\"}",
    "visual_metaphor": "{argument name=\"visual metaphor\" default=\"letters becoming a gateway, horizon, fracture, or shadowed architecture\"}",
    "image_role": "{argument name=\"image role\" default=\"portrait, object, or landscape only if it deepens the title meaning and interacts with the letters\"}"
  },
  "design": {
    "palette": "{argument name=\"palette\" default=\"4-6 restrained colors with one emotional accent\"}",
    "surface": "paper fiber, ink grain, subtle print texture",
    "composition": "premium editorial poster, dramatic scale, strong hierarchy, smart whitespace"
  },
  "constraints": {
    "must_keep": [
      "single finished poster only",
      "headline must be the primary visual structure",
      "imagery must interact with typography rather than sit beside it",
      "the poster must feel museum-grade and intentional"
    ],
    "avoid": [
      "default word-art effects",
      "misspelled headline text",
      "random unrelated icons",
      "turning the output into a presentation board or moodboard",
      "overloaded collage without hierarchy"
    ]
  }
}
```

### 参数策略

- 必问：标题、含义、视觉隐喻方向
- 可默认：高级编辑海报语气、限制色板、纸张印刷质感
- 可随机：留白位置、局部颗粒、图像与字形交叠方式

### 自动补全策略

- 若用户只给标题，自动先围绕“标题含义”构建视觉隐喻
- 默认 single poster only，禁止自动扩展成展示板
- 若用户给人物 / 场景，自动要求其与标题字形发生遮挡、穿插、浮现关系

## 变体 1：中文版概念字体海报

```json
{
  "type": "Chinese Conceptual Typography Poster",
  "headline": { "text": "{argument name=\"headline\" default=\"山海之间\"}" },
  "constraints": { "must_feel": "high-end editorial, culturally grounded, legible Chinese title" }
}
```

## 避免事项

- 不要把概念字体海报降级成普通 slogan banner
- 不要让图像元素和标题互不相干
- 不要让标题拼写出错或变得不可读
- 不要生成多方案拼贴展示板

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `conceptual-typography-poster`
- Retrieval styles: `Poster`
- Retrieval scenes: `Creative`, `Social`
- Curated example cases: `355`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=conceptual-typography-poster]`
