# 历史古风长卷 / 叙事场景模板

本文件用于生成“古风题材 / 历史人物 / 长卷叙事 / 诗词视觉”的场景图：

- 历史人物群像
- 古风长卷图
- 诗词视觉化场景
- 朝代主题叙事图
- 历史城市风貌与时间轴融合图

特征：

- 明确朝代 / 历史语境
- 长卷或册页式叙事布局
- 人物、建筑、文本三者协调
- 气质重于花哨特效

## 适用范围

- 古风长卷图
- 历史叙事场景
- 诗词 / 典故视觉化
- 历史人物群像

## 何时使用

- 用户提到“长卷 / 诗词图 / 古希腊 / 朝代 / historical scene / scroll / classical theme”
- 重点是历史氛围、人物关系、叙事层次、文本融合
- 需要的是场景图，不是单页海报或纯信息图

不要使用：

- 现代概念大片（用 `scenes-and-illustrations/concept-scene.md`）
- 纯复古信息图海报（用 `poster-and-campaigns/vintage-editorial-infographic.md`）
- 杂志封面式人物海报（用 `poster-and-campaigns/editorial-cover.md`）

## 缺失信息优先提问顺序

1. 历史主题 / 作品名 / 朝代或文明背景
2. 核心人物是谁（1-5 位）
3. 主要场景（江岸 / 都城 / 学院 / 街巷 / 宫廷）
4. 画幅形式（长卷 / 竖版叙事 / 册页）
5. 是否要加入原文或时间轴文字
6. 风格（工笔 / 水墨 / 史诗写意 / 古典壁画感）
7. 配色（米色纸本 / 青绿山水 / 赭石古卷 / 墨色）

## 主模板：历史叙事长卷场景

📖 描述

生成一张带有明确历史语境的叙事长卷图，人物、建筑、地貌与文字共同服务于同一主题。

📝 提示词

```json
{
  "type": "Historical Scroll Scene",
  "goal": "生成一张具有历史叙事、人物关系、场景层次与文本融合能力的古风长卷或历史场景图",
  "theme": {
    "subject": "{argument name=\"historical subject\" default=\"《赤壁怀古》\"}",
    "civilization_or_dynasty": "{argument name=\"civilization or dynasty\" default=\"Song-literati interpretation of Three Kingdoms history\"}",
    "narrative_focus": "{argument name=\"narrative focus\" default=\"the emotional tension between vast landscape, memory, and historical greatness\"}"
  },
  "characters": {
    "main_figures": "{argument name=\"main figures\" default=\"Su Shi imagined within the Red Cliff atmosphere, with implied historical echoes of Zhou Yu and Cao Cao\"}",
    "interaction": "{argument name=\"interaction\" default=\"figures should feel embedded in the historical world rather than pasted on top\"}"
  },
  "scene": {
    "location": "{argument name=\"location\" default=\"river cliff landscape with boats, mist, rock faces, and ancient sky\"}",
    "layout_format": "{argument name=\"layout format\" default=\"horizontal handscroll composition\"}",
    "text_integration": "{argument name=\"text integration\" default=\"selective lines of classical text woven into the scene along the visual flow\"}"
  },
  "style": {
    "art_style": "{argument name=\"art style\" default=\"elegant ink-wash + restrained color accents + textured paper grain\"}",
    "palette": "{argument name=\"palette\" default=\"warm parchment, muted ink black, desaturated blue-green and earth red\"}",
    "mood": "{argument name=\"mood\" default=\"majestic, reflective, poetic, historically grounded\"}"
  },
  "constraints": {
    "must_keep": [
      "historical tone must feel coherent rather than mixed-era collage",
      "text should support the scene, not overwhelm it",
      "characters, costumes, and architecture should share one cultural logic",
      "the composition must preserve scroll-like reading flow"
    ],
    "avoid": [
      "random modern props",
      "overly glossy fantasy effects",
      "mixed dynasties when historical accuracy matters",
      "tourist-poster clichés"
    ]
  }
}
```

### 参数策略

- 必问：主题、人物、场景、画幅形式
- 可默认：纸张质感、配色、文字布局
- 可随机：远景细节、次要器物、烟雾层次

### 自动补全策略

- 未指定时默认采用“长卷阅读流向”组织叙事
- 文本默认只摘取关键句，不做整页塞满正文
- 如果是古希腊 / 西方古典题材，也保持相同叙事逻辑，改为对应文明视觉元素

## 变体 1：古典哲人群像城市叙事图

📝 提示词

```json
{
  "type": "Classical Philosophy City Scene",
  "theme": {
    "subject": "{argument name=\"subject\" default=\"Socrates, Plato, and Aristotle in ancient Athens\"}"
  },
  "scene": {
    "location": "ancient Athenian street and city backdrop with timeline-like dialogue fragments"
  },
  "constraints": {
    "must_feel": "scholarly, mythic, grounded in one historical world"
  }
}
```

## 避免事项

- 不要把古风题材做成游戏 loading 海报
- 不要混搭多个时代的服装和器物
- 不要把长卷做成拥挤拼贴板
- 不要让文字压过主体叙事

## Hybrid retrieval metadata（Phase 1）

- Associated template IDs: `history-classical-themes`
- Retrieval styles: `History`, `Classical`, `Illustration`
- Retrieval scenes: `History`, `Story`
- Retrieval tags: `History`, `Classical`, `Scroll`
- Curated example cases: `375`, `338`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=history-classical-themes]`
