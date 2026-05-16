# 3D 收藏玩具 / 设计师公仔模板

本文件用于生成“高端 3D 收藏玩具 / designer toy / stylized figure”风格图：

- 头像转收藏公仔
- 品牌角色公仔
- 限量版玩具展示图
- 潮玩主视觉
- 角色 3D 化展示

特征：

- 大头小身比例可控
- 保留身份识别
- 材质统一
- 黑底或纯净背景更稳定
- 看起来像真实高级潮玩，不是廉价 3D 模型

## 适用范围

- 自拍 / 人像转 designer toy
- 品牌 mascot 公仔化
- 高端 3D 收藏玩具展示
- 角色立像视觉

## 何时使用

- 用户提到“collectible toy / designer toy / 公仔 / vinyl figure / stylized 3D figure”
- 需要保留人物身份，但转成夸张比例的玩具美学
- 输出重心是材质、造型和展示感

不要使用：

- 普通头像（用 `avatars-and-profile/character-grid-portrait.md`）
- 平面贴纸（用 `avatars-and-profile/sticker-set.md`）
- 风格迁移自拍（用 `avatars-and-profile/style-transfer-selfie.md`）

## 缺失信息优先提问顺序

1. 主体来源（自拍 / 角色描述 / 品牌角色）
2. 是否必须保留身份特征
3. 服装 / 道具 / 角色设定
4. 玩具材质（哑光 vinyl / 树脂 / 软胶）
5. 背景（黑底 / 展示台 / 包装盒）
6. 构图（全身 / 半身 / 带包装）
7. 比例（大头程度 / 写实程度）

## 主模板：高端 3D 收藏玩具展示

📖 描述

把人物或角色转译为高端 designer toy，美术重点是“保留身份 + 夸张比例 + 高级材质 + 展示感”。

📝 提示词

```json
{
  "type": "3D Collectible Figure Display",
  "goal": "把人物或角色转化为高端设计师公仔，保留识别度，同时形成统一、精致、可收藏的潮玩视觉",
  "subject": {
    "source": "{argument name=\"subject source\" default=\"uploaded reference portrait\"}",
    "identity_preservation": "{argument name=\"identity preservation\" default=\"preserve face identity, key facial structure, and signature expression\"}",
    "outfit": "{argument name=\"outfit\" default=\"minimal street-luxury outfit with one signature accessory\"}",
    "pose": "{argument name=\"pose\" default=\"confident centered full-body standing pose\"}"
  },
  "figure_design": {
    "proportion": "{argument name=\"proportion\" default=\"large head, slightly shortened body, still anatomically balanced for a premium collectible\"}",
    "material": "{argument name=\"material\" default=\"smooth matte vinyl with subtle realistic skin detail and clean edge transitions\"}",
    "finish": "{argument name=\"finish\" default=\"premium designer toy finish, not cheap plastic\"}"
  },
  "display": {
    "background": "{argument name=\"background\" default=\"clean black studio background\"}",
    "lighting": "{argument name=\"lighting\" default=\"soft studio key light with controlled rim highlights\"}",
    "composition": "{argument name=\"composition\" default=\"centered full-body hero display with sharp focus\"}"
  },
  "style": {
    "rendering": "{argument name=\"rendering\" default=\"ultra-sharp 8K stylized 3D render, premium collectible aesthetic, Pixar-grade material polish\"}"
  },
  "constraints": {
    "must_keep": [
      "identity should remain recognizable",
      "materials must feel premium and coherent",
      "stylization should enhance charm without becoming a generic cartoon blob",
      "the result should read as a collectible product shot"
    ],
    "avoid": [
      "cheap toy look",
      "muddy proportions",
      "plastic skin without detail",
      "busy background or unrelated props"
    ]
  }
}
```

### 参数策略

- 必问：主体来源、身份保留程度、服装 / 设定
- 可默认：材质、背景、灯光
- 可随机：小道具、底座细节、表面微纹理

### 自动补全策略

- 未指定时默认“黑底 + 软棚光 + centered full body”
- 保留人物最关键的脸部识别特征，不做完全重画成陌生人
- 材质默认哑光 vinyl，避免“过分真实但又不像玩具”的中间态

## 变体 1：带包装盒的限量版展示

📝 提示词

```json
{
  "type": "Collectible Figure with Packaging",
  "display": {
    "background": "premium retail showcase with subtle box graphics and product labeling"
  },
  "constraints": {
    "must_feel": "limited-edition launch visual"
  }
}
```

## 避免事项

- 不要让五官被过度卡通化到失去识别度
- 不要让材质像普通手游 3D 贴图
- 不要让背景过花导致主玩具不突出
- 不要出现廉价塑料反光

## Hybrid retrieval metadata（Phase 1）

- Associated template IDs: `3d-collectible-toy`
- Retrieval styles: `3D`, `Character`
- Retrieval scenes: `Creative`
- Retrieval tags: `Character`, `Style`, `Special`
- Curated example cases: `378`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=3d-collectible-toy]`
