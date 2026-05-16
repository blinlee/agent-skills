# Apple 风自然科普海报模板

本文件用于生成“主体极度放大 + 纯白背景 + 少量科学说明”的高级自然科普海报：

- Apple 风自然科普海报
- 现代极简动物 / 昆虫 / 生物海报
- 高级科普 poster
- 纯白信息克制型 science poster

特征：

- 9:16 竖版 poster
- 主体生物占画面 50%-70%
- 纯白或极浅灰背景，大留白
- 底部仅保留少量四列科学信息
- 像高端发布会视觉，而非传统百科展板

## 适用范围

- 自然科普海报
- 动植物 / 昆虫 / 爬行动物介绍海报
- 高级教育视觉 poster
- Apple keynote 风信息克制型生物图

## 何时使用

- 用户提到“自然科普海报 / Apple 风 science poster / 高级生物海报 / 白底极简动物信息图”
- 重点是一个被放大的主体 + 少量准确信息，而不是密集百科排版
- 希望更像产品发布海报而不是老式科普展板

不要使用：

- 传统复古信息图（用 `vintage-editorial-infographic.md`）
- 学术答辩研究总览图（用 `academic-figures/research-overview-poster.md`）
- 分步骤流程图（用 `infographics/step-by-step-infographic.md`）

## 缺失信息优先提问顺序

1. 物种名称（中文 / 英文）
2. 核心主体是什么（动物 / 昆虫 / 植物 / 微观对象）
3. 四个重点信息栏分别写什么
4. 主标题、副标题、底部总结句
5. 是否允许少量承托物（树枝 / 岩石 / 木皮）
6. 比例（默认 9:16）

## 主模板：Apple 风自然科普海报

📖 描述

生成一张极简、纯白、主体巨大的高级自然科普海报，信息区克制、排版像高端发布会视觉。

📝 提示词

```json
{
  "type": "Premium Nature Science Poster",
  "goal": "生成一张像 Apple keynote 视觉语言一样克制、干净、主体巨大的自然科普海报",
  "subject": {
    "species_name_cn": "{argument name=\"species name cn\" default=\"雪豹\"}",
    "species_name_en": "{argument name=\"species name en\" default=\"Snow Leopard\"}",
    "hero_subject": "{argument name=\"hero subject\" default=\"an ultra-detailed snow leopard with realistic fur and calm, powerful posture\"}",
    "support_surface": "{argument name=\"support surface\" default=\"a minimal rock surface only if needed\"}"
  },
  "layout": {
    "format": "9:16 vertical poster",
    "background": "pure white or extremely light gray gradient with generous whitespace",
    "title_block": "large Chinese title, restrained subtitle, English name, one short distribution line",
    "hero_scale": "subject occupies roughly 50%-70% of the visual area",
    "info_band": "bottom area uses four minimalist info columns separated by thin vertical lines"
  },
  "information": {
    "fact_1": "{argument name=\"fact 1\" default=\"Habitat / alpine range\"}",
    "fact_2": "{argument name=\"fact 2\" default=\"Diet / prey behavior\"}",
    "fact_3": "{argument name=\"fact 3\" default=\"Body adaptation / texture detail\"}",
    "fact_4": "{argument name=\"fact 4\" default=\"Conservation note / rarity\"}",
    "closing_line": "{argument name=\"closing line\" default=\"one restrained, memorable science summary\"}"
  },
  "visual_tone": {
    "style": "Apple-inspired premium editorial science poster",
    "lighting": "soft studio-quality light with credible shadow grounding the subject",
    "accent_colors": "limited to small icons and tiny headers only"
  },
  "constraints": {
    "must_keep": [
      "the subject must be the strongest visual center",
      "white background and whitespace must stay dominant",
      "the bottom information area must remain minimal and readable",
      "the image must feel premium, scientific, and modern"
    ],
    "avoid": [
      "old-paper encyclopedia styling",
      "rounded-card infographic panels",
      "dense text blocks",
      "children's cartoon science aesthetics",
      "making the subject too small"
    ]
  }
}
```

### 参数策略

- 必问：物种名、主体、四个信息点
- 可默认：纯白背景、底部四列、柔和棚拍光
- 可随机：细线 icon、小标题强调色、轻微背景柔光

### 自动补全策略

- 默认把主体做大，而不是堆环境
- 未指定时底部信息只保留 4 个短栏目，不展开长文
- 若用户只有英文物种名，自动补足“中文标题占大、英文名克制”的发布会式层级

## 变体 1：无底部信息的纯 hero 科普封面

```json
{
  "type": "Hero-only Nature Science Cover",
  "layout": { "info_band": "none or extremely reduced" },
  "constraints": { "must_feel": "museum cover, minimal, premium" }
}
```

## 避免事项

- 不要让主体缩成小标本
- 不要做成传统黄纸科普板
- 不要加入复杂卡片和装饰性框线
- 不要让文字压住主体关键结构

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `nature-science-poster`
- Retrieval styles: `Poster`, `Infographic`
- Retrieval scenes: `Education`
- Curated example cases: `339`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=nature-science-poster]`
