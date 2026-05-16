# 梗图与病毒传播内容模板

本文件用于生成具有传播力的梗图、恶搞图、讽刺图和病毒式社交媒体内容。这类内容的核心不是精美设计，而是"一句话让模型理解幽默意图并输出可传播的视觉"。

代表案例：

- 游戏封面恶搞（如 "Discord Mod Simulator" Switch 封面）
- 企业并购/收购恶搞图
- 品牌恶搞海报
- 虚构产品包装
- 名人/角色的荒诞场景

## 适用范围

- 社交媒体传播图
- 品牌营销中的"自黑"内容
- 社群互动梗图
- 虚构/假设性商业场景恶搞
- 玩梗性质的产品封面/包装

## 何时使用

- 用户的 prompt 带有明显的幽默/讽刺/恶搞意图
- 用户要求生成"梗图 / meme / 恶搞图 / 玩梗图"
- 用户给出的是一个荒诞的商业/产品/名人场景
- prompt 本身极短，依赖模型的世界知识来补全

不要使用：

- 用户要的是正式的品牌海报（用 `brand-poster.md`）
- 用户要的是产品营销图（用 `product-visuals/` 目录下的模板）
- 用户要的是专业的讽刺漫画/社论插画（用 `editorial-cover.md`）
- 用户的意图是严肃的商业场景，只是风格轻松（用对应业务模板）

## 缺失信息优先提问顺序

1. 梗的核心内容（什么和什么的反差/碰撞/恶搞）
2. 视觉形式（游戏封面 / 产品包装 / 社交媒体截图 / 海报 / 新闻图）
3. 幽默风格（讽刺 / 自黑 / 荒诞 / 反差萌 / 无厘头）
4. 是否需要特定品牌/人物/产品的真实外观
5. 比例和用途（社媒传播 / 群聊斗图 / 营销素材）

## 主模板：产品封面/包装恶搞

📖 描述

以真实产品的形式（游戏封面、商品包装、品牌海报）呈现一个虚构/荒诞的产品概念。关键在于"看起来像真的，但内容是假的"。

📝 提示词

```text
{argument name="product format" default="Nintendo Switch game cover"}: {argument name="joke title" default="Discord Mod Simulator"}

{argument name="additional style details" default="Professional game cover art, realistic box art style, ESRB rating, promotional screenshots on the back, official Nintendo branding"}.
```

### 参数策略

- 必问：恶搞标题/概念
- 可默认：产品形式（游戏封面 / 商品包装 / 品牌海报）
- 可随机：背面细节、评级标签、宣传语

### 自动补全策略

当用户只给出"XX 的图"这种极简指令时：

- 自动判断最合适的视觉形式（游戏封面、产品包装、社媒截图、海报）
- 自动补全该形式应有的细节元素（评级标签、条码、品牌 logo、宣传语）
- 恶搞点如果不够明确，基于标题的关键词推断幽默方向

## 变体 1：企业并购/商业恶搞

📝 提示词

```text
生成一张{argument name="company A" default="YouMind"}收购了{argument name="company B" default="ChatGPT"}的图。

风格要求：
- 看起来像正式的商业新闻配图或品牌联名海报
- 包含两个品牌的 logo 或视觉标识
- 有"收购完成"或"战略合并"的正式感
- 但内容本身是虚构/恶搞的

{argument name="additional details" default=""}
```

## 变体 2：虚构社媒截图

📝 提示词

```json
{
  "type": "虚构社交媒体截图",
  "platform": "{argument name=\"platform\" default=\"微博 / X / 朋友圈\"}",
  "person": "{argument name=\"person\" default=\"某个名人或虚构角色\"}",
  "content": "{argument name=\"post content\" default=\"荒诞/搞笑的发言内容\"}",
  "interactions": {
    "likes": "{argument name=\"likes\" default=\"99999\"}",
    "comments": "{argument name=\"comment count\" default=\"8888\"}",
    "top_comments": "{argument name=\"top comments\" default=\"3-5条有趣的评论\"}"
  },
  "style": "高仿真实平台截图，界面元素完整",
  "constraints": {
    "must_look_real": "界面必须像真正的手机截图",
    "text_must_be_readable": "所有中文文字必须清晰可读"
  }
}
```

## 避免事项

- 不要把梗图做得太精美以至于失去了"随手做的"随意感
- 不要在恶搞内容中加入真实的负面信息或诽谤内容
- 不要生成过于逼真的假新闻截图（避免误导）
- 不要忽略幽默的核心——反差感。如果"看起来完全正常"就不好笑了
- 不要在一个梗里塞太多梗，一个核心笑点就够了
- 不要用过于复杂的 prompt 结构——梗图的最佳 prompt 往往就是一句话

## Text QA Inspection Zones

- 标题/梗文案：必须准确显示指定的文字，不能变成乱码
- 品牌名/人名：如果涉及真实品牌或人物，名字必须正确
- 平台 UI 文字：如果模拟社媒截图，界面文字必须可读

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `meme-viral-content`
- Retrieval styles: `Illustration`, `Realistic`
- Retrieval scenes: `Social`, `Creative`
- Curated example cases: none yet
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=meme-viral-content]`
