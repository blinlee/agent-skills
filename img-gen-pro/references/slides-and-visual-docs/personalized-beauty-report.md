# 个性化美妆报告模板

本文件用于生成“分析 + 推荐 + 商品卡”一体化的个性化美妆报告：

- 肤色 / 唇色 / 气质分析报告
- 品牌口红推荐报告
- 护肤 / 彩妆导购视觉页
- 个性化 beauty assistant 结果页
- 带商品卡的生活方式推荐版面

特征：

- 报告式层级
- 结论明确
- 推荐矩阵清晰
- 商品卡与分析结果同时存在
- 视觉可偏品牌化 / 时尚编辑化

## 适用范围

- 美妆推荐报告
- 个性化肤色 / 唇色分析图
- 品牌口红 / 彩妆推荐页
- beauty shopping assistant 结果页

## 何时使用

- 用户提到“beauty report / skin analysis / lip color report / personalized recommendation / product cards”
- 既要有诊断结论，也要有推荐商品与说明
- 重点是结构化报告，而不是单张产品海报

不要使用：

- 纯产品主视觉（用 `product-visuals/premium-studio-product.md`）
- 单图人物 + 商品卡广告（用 `ui-mockups/product-card-overlay.md`）
- 通用 KPI 仪表盘（用 `infographics/kpi-dashboard-infographic.md`）

## 缺失信息优先提问顺序

1. 分析对象（自拍 / 模特 / 虚拟 persona）
2. 推荐品类（口红 / 底妆 / 护肤 / 综合 beauty）
3. 品牌（如 Dior / YSL / Armani / Chanel / TF）
4. 关注点（显白 / 通勤 / 温柔 / 气场 / 抗老 / 保湿）
5. 推荐数量（3-5）
6. 版式（极简白底 / 黑金时尚 / 品牌灰调）
7. 是否要保留分析区 + 推荐区 + 总结区三段结构

## 主模板：品牌化个性美妆报告页

📖 描述

生成一张竖版结构化美妆报告图，包含用户分析、品牌视觉、推荐矩阵和结论建议。

📝 提示词

```json
{
  "type": "Personalized Beauty Report",
  "goal": "基于分析对象与指定品牌，生成一张带有诊断结论、推荐矩阵、商品卡和总结建议的高级美妆报告页",
  "input": {
    "subject": "{argument name=\"subject\" default=\"a user selfie with natural makeup\"}",
    "category": "{argument name=\"beauty category\" default=\"lip color recommendation\"}",
    "brand": "{argument name=\"brand\" default=\"YSL\"}",
    "preference": "{argument name=\"style preference\" default=\"commute-friendly + flattering + premium\"}",
    "recommendation_count": "{argument name=\"recommendation count\" default=\"4\"}"
  },
  "brand_visual_identity": {
    "mood": "{argument name=\"brand mood\" default=\"black-gold, fashion editorial, sharp contrast\"}",
    "accent_usage": "{argument name=\"accent usage\" default=\"use brand accent only as thin lines, labels, and highlight details\"}"
  },
  "analysis": {
    "skin_tone": "{argument name=\"skin tone\" default=\"neutral warm, medium brightness\"}",
    "aura": "{argument name=\"aura\" default=\"clean, elegant, slightly cool\"}",
    "focus": "{argument name=\"analysis focus\" default=\"which shades brighten the complexion without becoming neon or too heavy\"}",
    "summary_sentence": "{argument name=\"summary sentence\" default=\"best suited to muted rose and refined red families with polished texture\"}"
  },
  "layout": {
    "header": "{argument name=\"header\" default=\"PERSONALIZED BEAUTY REPORT\"}",
    "left_panel": "subject input + skin-tone analysis",
    "center_panel": "3-5 try-on recommendation columns using the same face",
    "right_or_bottom_panel": "shade labels, effect notes, scene tags, concise recommendation logic"
  },
  "recommendations": {
    "items": [
      {
        "shade_name": "{argument name=\"shade 1\" default=\"#999 Classic Red\"}",
        "effect": "{argument name=\"effect 1\" default=\"brightens complexion, formal confidence\"}",
        "scenario": "{argument name=\"scenario 1\" default=\"important meetings\"}"
      },
      {
        "shade_name": "{argument name=\"shade 2\" default=\"Muted Rose\"}",
        "effect": "{argument name=\"effect 2\" default=\"soft everyday polish\"}",
        "scenario": "{argument name=\"scenario 2\" default=\"daily commute\"}"
      }
    ]
  },
  "style": {
    "rendering": "{argument name=\"rendering\" default=\"high-end beauty photography + editorial information design + minimal luxury layout\"}",
    "aspect_ratio": "{argument name=\"aspect ratio\" default=\"9:16\"}"
  },
  "constraints": {
    "must_keep": [
      "the same face identity across all try-on variants",
      "recommendation logic must be readable and differentiated",
      "brand styling should stay restrained rather than noisy",
      "the report must feel premium, not like a generic app card stack"
    ],
    "avoid": [
      "medical claims",
      "tiny unreadable notes",
      "heavy UI card borders",
      "messy color overload or plastic skin"
    ]
  }
}
```

### 参数策略

- 必问：分析对象、品类、品牌、关注点
- 可默认：版式、品牌点缀、推荐数量
- 可随机：辅助色号、场景标签、轻微排版点缀

### 自动补全策略

- 用户只给品牌和自拍时，自动补全“分析 + 推荐 + 总结”三段结构
- 推荐数量默认 4，保证每个推荐风格有差异
- 品牌视觉只做点缀，不做大面积杂乱铺色

## 变体 1：护肤诊断报告

📝 提示词

```json
{
  "type": "Personalized Skincare Report",
  "input": {
    "category": "skincare recommendation"
  },
  "analysis": {
    "focus": "moisture, sensitivity, texture, barrier condition"
  },
  "constraints": {
    "must_feel": "clinical but premium, still visually elegant"
  }
}
```

## 避免事项

- 不要做成普通 KPI dashboard
- 不要让推荐理由空泛重复
- 不要让所有推荐看起来没有风格差异
- 不要出现品牌重 logo 轰炸

## Hybrid retrieval metadata（Phase 1）

- Associated template IDs: `personalized-beauty-report`
- Retrieval styles: `Product`, `UI`
- Retrieval scenes: `Commerce`, `Fashion`
- Retrieval tags: `Product`, `Layout`, `Style`
- Curated example cases: `353`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=personalized-beauty-report]`
