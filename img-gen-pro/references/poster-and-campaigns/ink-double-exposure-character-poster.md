# 水墨双重曝光人物海报模板

本文件用于生成“人物剪影 + 下方主体 + 水墨叙事场景”的高级人物海报：

- 水墨双重曝光人物海报
- 文化气质人物宣传海报
- 诗意电影感人物主视觉
- 品牌主理人 / 运动员 / 角色的东方气质海报

特征：

- 9:16 竖版电影海报构图
- 上半区大剪影 / 头像，下半区人物主体
- 剪影内部融合场景、象征物、叙事片段
- 水墨扩散、飞白、留白、低饱和高级质感

## 适用范围

- 人物宣传海报
- 文化主题角色海报
- 东方水墨气质 campaign visual
- 高级人物故事感 poster

## 何时使用

- 用户提到“ink double exposure / 水墨双重曝光 / 东方水墨人物海报 / 诗意人物海报”
- 重点是人物身份、氛围和叙事，而不是信息图或商业大字排版
- 希望画面安静、克制、留白充足，但仍有海报级冲击力

不要使用：

- 大字主张海报（用 `typography-and-text-layout/conceptual-typography-poster.md`）
- 常规品牌主海报（用 `brand-poster.md`）
- 场景插画故事板（用 `scenes-and-illustrations/picture-book-scene.md`）

## 缺失信息优先提问顺序

1. 主体人物是谁（角色 / 主理人 / 运动员 / 历史人物）
2. 核心情绪或身份关键词
3. 需要融入剪影内部的关键场景 / 象征物 / 叙事片段
4. 是否需要标题 / 姓名 / 短句
5. 色调（墨黑 / 灰蓝 / 暖棕 / 冷白）
6. 比例（默认 9:16）

## 主模板：水墨双重曝光人物海报

📖 描述

生成一张人物身份极强、叙事克制、具有东方水墨气质和电影海报完成度的双重曝光人物海报。

📝 提示词

```json
{
  "type": "Ink Double Exposure Character Poster",
  "goal": "生成一张高级、克制、具有东方水墨电影感的人物双重曝光海报",
  "subject": {
    "identity": "{argument name=\"identity\" default=\"a visionary founder\"}",
    "pose": "{argument name=\"pose\" default=\"standing calmly with a quiet but powerful gaze\"}",
    "facial_focus": "{argument name=\"facial focus\" default=\"large portrait silhouette occupying the upper half\"}"
  },
  "composition": {
    "format": "9:16 vertical premium movie-poster composition",
    "top_zone": "enlarged portrait silhouette or head contour as the main anchor",
    "lower_zone": "full-body or half-body version of the same subject",
    "inner_narrative": "{argument name=\"inner narrative\" default=\"mountains, fog, symbolic architecture, cultural textures, and one key memory fragment\"}",
    "flow": "use mist, ink diffusion, flying-white edges, and negative space to connect top silhouette to lower figure"
  },
  "visual_tone": {
    "style": "East-Asian ink aesthetics fused with realistic cinematic portrait lighting",
    "palette": "{argument name=\"palette\" default=\"ink black, soft gray, muted ivory, one restrained accent color\"}",
    "texture": "paper fiber, subtle ink bleed, layered haze"
  },
  "text": {
    "title": "{argument name=\"title\" default=\"optional short title or name\"}",
    "rule": "very little text, readable, like a poetic poster inscription rather than an infographic"
  },
  "constraints": {
    "must_keep": [
      "the upper silhouette must remain the strongest recognition anchor",
      "narrative elements must support the subject identity",
      "negative space and ink texture must feel refined rather than noisy",
      "the poster must feel premium and cinematic"
    ],
    "avoid": [
      "cheap fantasy collage",
      "crowded background",
      "loud wuxia VFX",
      "copying an existing movie-poster layout",
      "letting text overpower the subject"
    ]
  }
}
```

### 参数策略

- 必问：人物身份、核心气质、剪影内部叙事元素
- 可默认：9:16、墨黑灰白色系、少量题签文字
- 可随机：云雾层次、纸张肌理、水墨扩散边缘

### 自动补全策略

- 未指定时默认上半区大剪影 + 下半区人物主体
- 默认文字极少，优先保留人物识别和叙事氛围
- 若用户给的是品牌人物，自动弱化“古风”，增强高级 campaign 感

## 变体 1：无文字纯视觉版

```json
{
  "type": "Textless Ink Double Exposure Poster",
  "text": { "title": "" },
  "constraints": { "must_feel": "gallery-grade, quiet, poetic, visual-only" }
}
```

## Exemplars from research collection

以下是来自社区的真实使用案例：

**MrBeast 暗黑奇幻角色海报**
> Prompt: "Create an anime fantasy character poster of MrBeast reimagined as a dark armored demon warrior. Show a confident male hero with a recognizable face, black-and-blue spiked armor, exposed torso, dramatic low-angle pose, glowing blue demonic creature behind him, vivid magenta and blue lighting, and readable 'MR BEAST' text on a banner in the background."
> 要点：名人角色转换（真人→奇幻战士）是本模板的高频用法。关键挑战：1) 保持人物面部辨识度 2) 融入幻想元素 3) 背景文字必须可读。

## 避免事项

- 不要把双重曝光做成廉价拼贴特效
- 不要用满版复杂景物把人物压没
- 不要让剪影内部元素与人物身份无关
- 不要让文字、logo、标语变成主角

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `ink-double-exposure-poster`
- Retrieval styles: `Poster`, `Illustration`, `Classical`
- Retrieval scenes: `Story`, `History`
- Curated example cases: `359`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=ink-double-exposure-poster]`
