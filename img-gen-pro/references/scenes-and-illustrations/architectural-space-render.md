# 建筑与空间表现模板

本文件用于生成“建筑空间表现 / 室内渲染 / 环境概念图”：

- 室内设计效果图
- 酒店 / 展厅 / 零售空间渲染
- 建筑外观表现图
- 空间规划概念图
- 城市级环境概念图

特征：

- 视角受控
- 材质与结构清晰
- 冷暖光关系明确
- 强调空间功能与动线
- 写实渲染而不是平面技术图

## 适用范围

- 室内设计效果图
- 建筑空间渲染
- 展厅 / 酒店 / 商业空间表现
- 环境概念图

## 何时使用

- 用户提到“architecture render / interior render / 空间效果图 / 大堂 / 展厅 / 酒店 lobby / 建筑表现”
- 用户希望输出的是写实空间图，而不是软件系统图或流程图
- 重点在空间、材质、采光、视角、氛围

不要使用：

- 软件系统架构图（用 `technical-diagrams/system-architecture.md`）
- 城市手绘地图（用 `maps/illustrated-city-map.md`）
- 纯概念大片不强调空间结构（用 `scenes-and-illustrations/concept-scene.md`）

## 缺失信息优先提问顺序

1. 空间类型（酒店大堂 / 咖啡馆 / 零售店 / 展厅 / 住宅）
2. 功能定位（接待 / 展示 / 社交 / 通行 / 居住）
3. 风格（现代极简 / 工业 / 新中式 / 侘寂 / 奢华）
4. 材质（木 / 石 / 金属 / 玻璃 / 织物）
5. 视角（人眼平视 / 广角 / 鸟瞰）
6. 光线与时间（白天 / 蓝调夜景 / 金色时刻）
7. 是否有室外环境透视（森林 / 城市街景 / 庭院 / 海景）
8. 比例（16:9 / 4:5 / 9:16）

## 主模板：写实建筑空间渲染

📖 描述

生成一张写实建筑空间效果图，重点是空间层次、材质、采光、结构逻辑和可使用感。

📝 提示词

```json
{
  "type": "Architectural Space Render",
  "goal": "生成一张写实建筑空间表现图，用于设计提案、空间概念展示或商业视觉沟通",
  "space": {
    "type": "{argument name=\"space type\" default=\"boutique hotel lobby\"}",
    "function": "{argument name=\"space function\" default=\"reception + waiting + social lounge\"}",
    "style": "{argument name=\"style\" default=\"modern warm minimalism\"}",
    "materials": "{argument name=\"materials\" default=\"travertine stone, warm timber, bronze metal, low-iron glass, soft linen upholstery\"}",
    "structure": "{argument name=\"space structure\" default=\"double-height lobby with clear circulation axis and layered seating zones\"}",
    "circulation": "{argument name=\"circulation\" default=\"a strong main path from entrance to reception desk, with side lounge pockets\"}"
  },
  "environment": {
    "outside_view": "{argument name=\"outside view\" default=\"city street with soft greenery and filtered daylight\"}",
    "time_of_day": "{argument name=\"time of day\" default=\"late afternoon\"}",
    "lighting_strategy": "{argument name=\"lighting strategy\" default=\"cool daylight from glazing balanced with warm concealed interior lighting\"}"
  },
  "camera": {
    "angle": "{argument name=\"camera angle\" default=\"eye-level perspective\"}",
    "lens": "{argument name=\"lens\" default=\"24mm wide-angle\"}",
    "framing": "{argument name=\"framing\" default=\"show the full spatial hierarchy without extreme distortion\"}"
  },
  "style": {
    "render_quality": "{argument name=\"render quality\" default=\"hyper-realistic architectural visualization, ray-traced lighting, clean but believable textures\"}",
    "mood": "{argument name=\"mood\" default=\"quiet, premium, welcoming, high-end hospitality\"}"
  },
  "constraints": {
    "must_keep": [
      "perspective must feel structurally believable",
      "material transitions must be coherent",
      "space should read as usable and intentional",
      "lighting must preserve cold/warm balance"
    ],
    "avoid": [
      "impossible perspective distortion",
      "random decorative clutter",
      "conflicting material language",
      "diagram-like boxy labels or software-architecture styling"
    ]
  }
}
```

### 参数策略

- 必问：空间类型、功能、风格、视角
- 可默认：材质组合、时间、灯光策略
- 可随机：配饰、植物、软装细节

### 自动补全策略

- 未指定时默认“人眼平视 + 广角但不过度畸变”
- 未指定材料时采用 3-4 种主材，不做无意义堆砌
- 未指定灯光时使用“室外冷光 + 室内暖光”的经典建筑表现逻辑

## 变体 1：夜景外立面

📝 提示词

```json
{
  "type": "Architectural Exterior Night Render",
  "space": {
    "type": "{argument name=\"building type\" default=\"cultural center\"}"
  },
  "environment": {
    "time_of_day": "blue hour",
    "lighting_strategy": "glowing interior volume, restrained facade lighting, wet pavement reflections"
  },
  "constraints": {
    "must_feel": "cinematic yet architecturally credible"
  }
}
```

## 避免事项

- 不要把建筑空间误做成技术框图
- 不要出现明显不合理的透视塌陷
- 不要让材质全部同质同色导致空间失去层次
- 不要让家具或装饰品喧宾夺主

## Hybrid retrieval metadata（Phase 1）

- Associated template IDs: `architecture-space`
- Retrieval styles: `Architecture`
- Retrieval scenes: `Travel`, `Commerce`
- Retrieval tags: `Architecture`, `Interior`, `Map`
- Curated example cases: `331`, `11`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=architecture-space]`
