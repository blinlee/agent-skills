# 城市创意字体设计模板

本文件用于生成"以城市名为主体、将地域文化符号融入笔画结构"的创意字体插画。文字本身成为画面主视觉，城市元素在笔画间自然生长，不是拼贴叠加。

代表案例：

- 杭州（西湖断桥、雷峰塔、龙井茶叶、丝绸飘带）
- 成都（熊猫、火锅、竹林、盖碗茶）
- 西安（城墙、兵马俑、大雁塔、肉夹馍）
- 苏州（园林、昆曲、丝绸、桂花）

## 适用范围

- 城市文旅宣传主视觉
- 地域文化品牌字体设计
- 城市 IP / 城市名片视觉
- 文创产品包装字体
- 社媒城市主题传播图

## 何时使用

- 用户提到"城市字体 / 城市创意字 / 地名艺术字"
- 用户要把城市名做成主视觉，而不是在画面角落放个小字
- 用户希望文字和城市文化元素融合为一体

不要使用：

- 用户只要普通标题排版（用 `title-safe-poster.md`）
- 用户要做双语信息图排版（用 `bilingual-layout-visual.md`）
- 用户要的是概念字体海报（用 `conceptual-typography-poster.md`）
- 用户要的是书法手写字（用下方"变体 3：书法默写风格"或独立书法模板）

## 缺失信息优先提问顺序

1. 城市名（必填）
2. 想融入的地域元素（地标、食物、植物、文化符号等，2-6 个）
3. 色彩基调（东方低饱和 / 鲜艳国潮 / 黑金高级 / 彩墨手绘）
4. 比例（3:2 / 1:1 / 9:16 / 16:9）
5. 背景质感（宣纸 / 纯白 / 渐变 / 纹理纸）
6. 是否需要英文副标题或拼音

## 主模板：城市名 + 地域元素深度融合

📖 描述

城市名作为画面唯一主体，文字笔画内融合城市标志性建筑与文化符号。元素顺应笔画走势自然生成，结构一体化，不可拼贴堆砌。整体风格为东方意境，线条柔和流动，辅以水波或烟雾纹理在笔画间隐约扩散。

📝 提示词

```json
{
  "type": "城市创意字体插画",
  "goal": "以城市名为视觉主体，将地域文化符号深度融入文字笔画结构，生成一张兼具字体设计感与城市文化意象的高级插画",
  "text": "{argument name=\"city name\" default=\"杭州\"}",
  "char_decomposition": {
    "char_1": {
      "character": "{argument name=\"first character\" default=\"杭\"}",
      "embedded_elements": "{argument name=\"elements for char 1\" default=\"西湖断桥、雷峰塔、湖岸柳树与远山轮廓，所有元素顺应笔画走势自然生成\"}"
    },
    "char_2": {
      "character": "{argument name=\"second character\" default=\"州\"}",
      "embedded_elements": "{argument name=\"elements for char 2\" default=\"龙井茶叶、丝绸飘带、水乡屋檐、小桥流水，元素与笔画交织生长，形成有机结构\"}"
    }
  },
  "style": {
    "aesthetic": "{argument name=\"aesthetic style\" default=\"江南水乡意境，线条柔和流动\"}",
    "color_palette": "{argument name=\"color palette\" default=\"低饱和东方配色：青灰、淡绿、米白、浅墨色\"}",
    "texture": "水波纹理在笔画间隐约扩散，增强空间层次与韵律感"
  },
  "background": {
    "type": "{argument name=\"background style\" default=\"干净米白色宣纸质感\"}",
    "texture_detail": "带轻微纸张纹理"
  },
  "output": {
    "aspect_ratio": "{argument name=\"aspect ratio\" default=\"3:2\"}",
    "quality": "4K",
    "style": "高精细插画风格，结构清晰但富有艺术表现力，元素融合自然，无明显边界"
  },
  "constraints": {
    "must_keep": [
      "文字是画面唯一主体，不是背景装饰",
      "城市元素必须与笔画融为一体，不能是拼贴叠加",
      "笔画结构清晰可辨认，不能因为融合元素而变成涂鸦",
      "整体具有高级设计感与文化审美"
    ],
    "avoid": [
      "卡通化、过度装饰、廉价国潮风",
      "元素与笔画边界分明的拼贴感",
      "文字变成抽象图案不可辨认",
      "颜色杂乱、对比度过高",
      "背景喧宾夺主"
    ]
  }
}
```

### 参数策略

- 必问：城市名、要融入的地域元素
- 可默认：色彩基调、背景质感、比例
- 可随机：水波/烟雾纹理细节、笔画间过渡方式

### 自动补全策略

当用户只给出"城市名"时：

- 自动推测该城市 2-4 个标志性元素
- 色彩默认使用低饱和东方配色
- 背景默认宣纸质感
- 比例默认 3:2

## 变体 1：国潮鲜艳风格

📝 提示词

```json
{
  "type": "城市创意字体插画",
  "text": "{argument name=\"city name\" default=\"成都\"}",
  "char_decomposition": {
    "char_1": {
      "character": "{argument name=\"first character\" default=\"成\"}",
      "embedded_elements": "{argument name=\"elements for char 1\" default=\"熊猫脸谱、竹林、盖碗茶\"}"
    },
    "char_2": {
      "character": "{argument name=\"second character\" default=\"都\"}",
      "embedded_elements": "{argument name=\"elements for char 2\" default=\"火锅、川剧变脸、银杏叶\"}"
    }
  },
  "style": {
    "aesthetic": "国潮风，线条有力，色块鲜明",
    "color_palette": "朱红、明黄、翠绿、藏蓝，高饱和撞色"
  },
  "background": {
    "type": "渐变深色背景"
  }
}
```

## 变体 2：英文城市名风格

📝 提示词

```json
{
  "type": "城市创意字体插画",
  "text": "{argument name=\"city name in English\" default=\"SHANGHAI\"}",
  "char_decomposition": {
    "style": "英文字母内融入城市元素",
    "embedded_elements": "{argument name=\"city elements\" default=\"外滩天际线、东方明珠、石库门建筑、梧桐树、旗袍纹样\"}"
  },
  "style": {
    "aesthetic": "海派复古，Art Deco 线条感",
    "color_palette": "黑金配色，辅以酒红与米白"
  }
}
```

## 避免事项

- 不要把城市元素画成独立的小图标贴在文字旁边，必须融入笔画内部
- 不要让笔画结构被元素破坏到无法辨认
- 不要用过于写实的建筑照片风格，应该是插画感
- 不要把所有城市元素堆在一个字里，合理分配到不同字符
- 不要忽略笔画间的留白和呼吸感
- 不要在文字周围加大量装饰性花纹，主体就是文字本身
- 不要用默认电脑字体风格，必须是手绘设计感

## Text QA Inspection Zones

- 主文字区：城市名必须清晰可辨认，不能是乱码或抽象图案
- 如有副标题/拼音/英文：必须准确拼写，不能有拼写错误
- 元素标注区：如有 callout 标注，文字必须可读

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `city-creative-font`
- Retrieval styles: `Typography`, `Illustration`
- Retrieval scenes: `Creative`, `Commerce`
- Curated example cases: none yet
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=city-creative-font]`
