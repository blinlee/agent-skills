# 不可能概念产品设计模板

本文件用于生成"看起来真实但违背物理常识"的概念产品图——没有拉链的夹克、没有表冠的腕表、没有缝线的钱包。核心是让模型在保持产品摄影真实感的同时，呈现违反常规的结构设计。

代表案例：

- 无拉链无纽扣无缝闭合的夹克
- 无表冠无按钮自校时的密封腕表
- 无缝线无搭扣无可见开口的钱包
- 无把手的门、无按键的遥控器、无接口的手机

## 适用范围

- 概念产品发布视觉
- 工业设计灵感图
- 设计挑战 / 创意实验
- 品牌 Campaign 中的"反常规"视觉
- 社媒传播的概念设计图

## 何时使用

- 用户提到"没有 XX 的 XX"（减法设计）
- 用户要求产品看起来真实但结构不可能
- 用户关注的是"约束条件下的设计美学"
- 用户的 prompt 用一句话描述了一个物理上很难实现的产品

不要使用：

- 用户要的是正常的产品图（用 `premium-studio-product.md`）
- 用户要的是产品爆炸视图（用 `exploded-view-poster.md`）
- 用户要的是产品白底图（用 `white-background-product.md`）
- 用户要的是未来科技感产品（用 `scenes-and-illustrations/concept-scene.md`）

## 缺失信息优先提问顺序

1. 产品是什么（夹克/腕表/钱包/其他）
2. 要去掉什么（拉链/纽扣/缝线/接口/按钮/把手）
3. 如何"闭合/工作"（磁吸？一体成型？自愈材料？）
4. 风格偏好（极简白底 / 场景化 / 杂志感）
5. 比例

## 主模板：减法设计概念产品

📖 描述

一个真实感产品图，产品去掉了某个关键物理组件，但仍然完美地实现了该组件的功能。看起来像高端产品摄影，但仔细看会发现"这个东西不可能存在"。

📝 提示词

```text
A {argument name="product" default="jacket"} with {argument name="removed feature" default="no zip, no buttons, no fastening"} — {argument name="impossible function" default="closes perfectly"}.
```

### 参数策略

- 必问：产品、要去掉的特征
- 可默认：闭合/工作方式（让模型自行推断）
- 可随机：拍摄风格（白底/场景/杂志）

### 自动补全策略

当用户只给出"没有 XX 的 XX"时：

- 自动推断产品类别和被移除特征的功能
- 默认使用极简产品摄影风格
- 让模型自行决定"如何实现不可能的功能"

## 变体 1：场景化概念产品

📝 提示词

```text
A realistic product photograph of a {argument name="product" default="leather wallet"} with {argument name="impossible constraint" default="no stitching, no clasp, no visible opening"}.

The wallet should be sitting on a {argument name="surface" default="dark marble table"} in a {argument name="setting" default="minimalist studio"} environment. Lighting is {argument name="lighting" default="soft overhead with subtle shadows"}. The wallet looks completely real and tangible, but its construction defies conventional manufacturing.

{argument name="additional style" default="Shot on medium format camera, shallow depth of field, warm tone"}
```

## 变体 2：系列概念产品对比

📝 提示词

```json
{
  "type": "概念产品系列对比图",
  "layout": "2x2 grid, each cell showing a different impossible product",
  "products": [
    "{argument name=\"product 1\" default=\"A jacket with no zip, no buttons, no fastening — closes perfectly\"}",
    "{argument name=\"product 2\" default=\"A watch with no crown, no buttons — a sealed case that sets itself\"}",
    "{argument name=\"product 3\" default=\"A leather wallet with no stitching, no clasp, no visible opening\"}",
    "{argument name=\"product 4\" default=\"A phone with no ports, no buttons, no camera bump\"}"
  ],
  "style": {
    "background": "统一纯白或浅灰",
    "lighting": "统一正面柔光",
    "consistency": "所有产品使用同一拍摄风格和比例"
  },
  "text_overlay": {
    "enabled": true,
    "content": "每格底部标注产品名和被移除的特征"
  }
}
```

## 避免事项

- 不要让产品看起来太科幻——它应该看起来像"明天就能买到"的现实产品
- 不要在画面里加过多解释性文字，产品本身就是焦点
- 不要让"不可能"的部分看起来像渲染错误或 AI 失误
- 不要忽略产品的材质真实感（皮革纹理、金属反光、布料褶皱）
- 不要把概念画画成草图，必须是成品级产品摄影感
- 不要在一个产品里加太多不可能的特征，一个核心矛盾就够了

## Text QA Inspection Zones

- 产品上的品牌名/型号：如有，必须清晰可读
- 如有对比图的文字标注：每格的描述文字必须准确

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `impossible-concept-product`
- Retrieval styles: `Product`, `Concept`
- Retrieval scenes: `Creative`, `R&D`
- Curated example cases: none yet
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=impossible-concept-product]`
