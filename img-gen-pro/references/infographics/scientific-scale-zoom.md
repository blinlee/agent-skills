# 科学尺度缩放信息图模板

本文件用于生成“从微观到宏观逐层缩放”的科学信息图：

- 生物 / 病毒 / 材料尺度图
- 多层级科学放大解释图
- 微观到宏观的教育信息图
- 科普尺度比较图

特征：

- 6-8 个尺度层级
- 每层都有对象、标签和放大关系
- 结构必须严格，不是随意拼贴
- 兼顾视觉冲击与可理解性

## 适用范围

- 科学尺度缩放图
- 生物 / 物理 / 材料科普图
- 多层级 zoom infographic
- 教育演示图

## 何时使用

- 用户提到“at every scale / scale infographic / zoom sequence / 微观到宏观 / 尺度缩放图”
- 重点是层级、放大关系、科学感，而不是商业海报
- 需要用 6-8 个层级逐步解释同一主题

不要使用：

- 纯统计对比图（用 `infographics/comparison-infographic.md`）
- 论文式复杂图表（用 `academic-figures/publication-chart.md`）
- 机制结构图（用 `academic-figures/mechanism-diagram.md`）

## 缺失信息优先提问顺序

1. 主题（病毒 / 细胞 / 材料 / 城市系统 / 数学概念）
2. 要展示多少层尺度（6-8）
3. 每层是否要短标签 / 单位 / 放大倍率
4. 风格（科学编辑 / atlas / glossy 3D / 极简教育）
5. 比例（竖版 9:16 / 海报 4:5 / 横版 16:9）
6. 是否有严格标题文案

## 主模板：微观到宏观尺度缩放图

📖 描述

围绕同一主题，按尺度递进方式展示 6-8 层对象，每层既有视觉主角，也有少量可读标签与放大关系。

📝 提示词

```json
{
  "type": "Scientific Scale Zoom Infographic",
  "goal": "生成一张从微观到宏观逐层放大的科学尺度缩放信息图，让读者直观理解同一主题在不同尺度下的形态与关系",
  "subject": {
    "topic": "{argument name=\"topic\" default=\"coronavirus\"}",
    "title": "{argument name=\"title\" default=\"AT EVERY SCALE\"}"
  },
  "structure": {
    "layer_count": "{argument name=\"layer count\" default=\"7\"}",
    "progression": "{argument name=\"progression\" default=\"micro to macro\"}",
    "frame_shape": "{argument name=\"frame shape\" default=\"circular or hexagonal zoom modules\"}",
    "annotation_style": "{argument name=\"annotation style\" default=\"short labels, unit markers, and clean connecting lines\"}"
  },
  "style": {
    "rendering": "{argument name=\"rendering\" default=\"scientific editorial infographic with high-detail 3D renders and precise hierarchy\"}",
    "palette": "{argument name=\"palette\" default=\"controlled scientific palette with one accent color for scale transitions\"}",
    "background": "{argument name=\"background\" default=\"light paper or soft neutral scientific backdrop\"}"
  },
  "constraints": {
    "must_keep": [
      "each scale level must feel different in magnitude",
      "labels must stay short and readable",
      "connectors must explain progression clearly",
      "the layout must remain structurally disciplined"
    ],
    "avoid": [
      "reusing the same object size at every level",
      "long paragraphs inside the image",
      "generic magnifying-glass clichés",
      "random decorative clutter"
    ]
  }
}
```

### 参数策略

- 必问：主题、层数、标题
- 可默认：模块形状、标注风格、背景
- 可随机：局部渲染细节、连接线细节

### 自动补全策略

- 未指定时默认 7 层结构
- 标注默认每层 3-5 词，避免长段文字
- 视觉上默认从微观到宏观，保证层级差异明显

## 避免事项

- 不要把所有层级画成同样大小
- 不要用“放大镜 + 一堆小字”的廉价模板感
- 不要让视觉层级先于科学关系崩掉
- 不要塞满长段正文

## Hybrid retrieval metadata（Phase 1）

- Associated template IDs: `scientific-scale-diagram`
- Retrieval styles: `Infographic`, `Charts`, `Realistic`
- Retrieval scenes: `Education`, `Tech`
- Retrieval tags: `Infographic`, `Chart`, `Education`
- Curated example cases: `341`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=scientific-scale-diagram]`
