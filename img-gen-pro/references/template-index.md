# 模板索引

按任务类型只读取最贴近的具体模板文件，不要一次性全读整个 `references/`。

## 1. 方法论总文档

先读：

- `references/prompt-writing.md`

适用于：

- 你还没决定怎么构造 JSON 模板
- 你需要判断哪些字段该问、哪些字段可默认、哪些字段可随机
- 你需要把案例抽象成可复用模板

## 2. UI Mockups (`references/ui-mockups/`)

适合各种"界面 + 内容"的样机视觉。当前已落地：

- `live-commerce-ui.md` — 电商直播带货截图样机（主播 + 聊天区 + 礼物区 + 商品卡）
- `social-interface-mockup.md` — 社交平台动态详情页样机（Twitter/X、小红书、微博、Threads 等）
- `product-card-overlay.md` — 落地页 hero / 详情页主图（人物 + 商品 + 卖点 + 价格）
- `chat-interface-scene.md` — 聊天 / 对话界面样机（iMessage、微信、群聊、AI 助手）
- `short-video-cover-ui.md` — 短视频封面 / 直播缩略图（YouTube、抖音、B 站、VTuber stream）
- `landing-page-case-study.md` — 深色 SaaS / 营销 case study **长页面** UI mockup（多 section + 滚动叙事 + 数据卡 + CTA）

## 3. Product Visuals (`references/product-visuals/`)

适合"以商品为视觉中心"的图。当前已落地：

- `exploded-view-poster.md` — 产品爆炸视图海报（主体垂直堆叠 + callout + 顶部 logo + 底部品牌区）
- `white-background-product.md` — 电商纯白底主图（单品 / 多角度 / 极简营销叠层）
- `premium-studio-product.md` — 高级影棚商业产品图（杂志广告级氛围）
- `packaging-showcase.md` — 礼盒 / 包装展示图（外盒 + 内容物展示）
- `lifestyle-product-scene.md` — 生活方式产品场景图（商品出现在真实场景中）
- `ecommerce-marketing-board.md` — 中式电商超复合销售看板（主图 + 详情页 + 卖点 + 使用步骤 + 场景 + TVC 分镜组合一图）
- `impossible-concept-product.md` — 约束驱动概念产品设计（无拉链夹克、无表冠腕表、无缝线钱包等"不可能"约束）

## 4. Maps (`references/maps/`)

适合"地图类视觉"（信息图已抽离到独立分类 17）。当前已落地：

- `food-map.md` — 城市美食手绘地图（编号点位 + 图例 + 中心吉祥物）
- `travel-route-map.md` — 旅行路线图（多日行程 / 单日 city walk / 户外路线）
- `illustrated-city-map.md` — 城市风貌插画地图（地标 + 江山 + 文化元素）
- `store-distribution-map.md` — 品牌门店 / 服务覆盖分布图
- `itinerary-day-trip-map.md` — **一日游** split 海报（左 parchment 行程卡 + 右奇幻写实地图，5-7 站点严格对齐）

## 5. Slides & Visual Docs (`references/slides-and-visual-docs/`)

适合"一页讲清楚一件事"的视觉文档。当前已落地：

- `dense-explainer-slides.md` — Irasutoya × 霞关混合高密度讲解 Slide
- `policy-style-slide.md` — 政策 / 政府公告 / 白皮书风格说明 Slide
- `visual-report-page.md` — 商业报告执行摘要 / 投资人简报 / 年报概览页
- `educational-diagram-slide.md` — 教学示意图（概念 / 机制 / 流程分解）

## 6. Poster & Campaigns (`references/poster-and-campaigns/`)

适合"品牌主视觉 + campaign + banner + 杂志封面"。当前已落地：

- `brand-poster.md` — 品牌主海报（产品 / 人物 / 纯文字主张）
- `campaign-kv.md` — Campaign Key Visual + 衍生 layout 系统
- `banner-hero.md` — Web hero / 落地页 / app banner（横向构图 + CTA）
- `editorial-cover.md` — 杂志 / 期刊 / 出版物封面
- `biomimetic-concept-poster.md` — 仿生工业设计概念海报（自然原型 → 演化条 → hero render → 多视图技术图）
- `vintage-editorial-infographic.md` — 复古档案 / 1940s 编辑式信息图海报（人物 + 公式 + 时间轴 + 模型，Bell Labs 风）
- `character-catalog-poster.md` — 同一角色多版本信息图海报（星座 / 元素 / 朝代 / 人格系列卡片）
- `lineup-comparison-poster.md` — 系列产品 lineup 对比信息图海报（30+ SKU 同图 + 图例 + 等级 key）

## 7. Portraits & Characters (`references/portraits-and-characters/`)

适合"人物视觉"。当前已落地：

- `professional-portrait.md` — 职业级商务肖像（LinkedIn / 团队页 / 媒体配图）
- `founder-portrait.md` — 创始人媒体大片肖像（戏剧灯光 + 留标题位）
- `virtual-host.md` — VTuber / 虚拟主播个人卡 + 直播预览
- `character-sheet.md` — 角色综合设定稿（三视图 + 表情 + 服装 + 配色板）
- `pose-reference-sheet.md` — N×N 姿势 / 动作字典参考表（同一角色多姿势，舞蹈 / 战斗 / 健身）
- `fashion-lookbook-pose.md` — 时尚穿搭姿态引导（Pinterest 风格单袖姿态 / 慵懒松弛 / 极简 prompt 控制姿态）

## 8. Scenes & Illustrations (`references/scenes-and-illustrations/`)

适合"氛围 + 故事 + 情绪"的插画类视觉。当前已落地：

- `healing-scene.md` — 治愈系日常 / 季节场景插画
- `concept-scene.md` — 电影感概念大场景 / IP key art
- `picture-book-scene.md` — 童书 / 绘本内页 / 节日卡片
- `minimalist-mood-scene.md` — 极简留白氛围图 / 文学性壁纸
- `documentary-street-moment.md` — 纪实街拍瞬间 / 新闻摄影风格
- `historical-scroll-scene.md` — 历史长卷 / 古风全景场景
- `architectural-space-render.md` — 建筑空间渲染 / 室内设计效果图
- `meme-and-viral-content.md` — 梗图 / 玩梗 / 社媒传播图（极简 prompt + 世界知识 + 幽默理解）
- `text-on-objects.md` — 物体表面文字渲染 + 真实屏幕生成（香蕉经文、工程师屏幕等边界测试）

## 9. Editing Workflows (`references/editing-workflows/`)

适合"基于现有图片做编辑"的图改任务（对应 `scripts/edit.js`）。当前已落地：

- `background-replacement.md` — 背景替换（商品 / 人像 / 户外 / 棚景）
- `local-object-replacement.md` — 局部对象替换（配合或不配合蒙版）
- `object-removal.md` — 杂物 / 路人 / 电线 / 瑕疵去除
- `product-retouching.md` — 产品精修（光泽 / 标签 / 阴影 / 瑕疵）
- `portrait-local-edit.md` — 人像局部修改（发型 / 服装 / 妆容 / 配饰）
- `multi-reference-composition.md` — 多参考图融合编辑（双图背景融合、产品场景迁移、人物环境合成）

## 10. Avatars & Profile (`references/avatars-and-profile/`)

适合"风格化头像 / 人设 / 网格 / 贴纸 / 系列肖像"等"个人形象"类视觉。当前已落地：

- `style-transfer-selfie.md` — 把参考图人物转成 cosplay / 哥特 / 复古胶片 / 偶像写真等任意风格
- `character-grid-portrait.md` — 同一角色 n×n 网格肖像（多职业 / 多表情 / 多朝代 / 多风格）
- `themed-3d-icon.md` — Kawaii 3D / Minecraft / 拟物 3D 应用图标式头像
- `sticker-set.md` — 贴纸套装 / 表情包合集（独立元素 + 描边 + 标签）
- `cultural-portrait-series.md` — 朝代 / 神话 / 文学 / 民族系列肖像
- `collectible-figure-display.md` — 3D 潮玩手办 / 盲盒公仔展示

## 11. Storyboards & Sequences (`references/storyboards-and-sequences/`)

适合"多分镜 / 漫画 / 关系图 / 流程步骤"等"叙事性序列"类视觉。当前已落地：

- `four-panel-comic.md` — 4 格漫画 / 讽刺漫画 / 段子漫画（起承转合 + 对话气泡）
- `manga-spread-page.md` — 单页 / 跨页漫画分镜（不规则格子 + 对话 + 心声）
- `anime-key-visual.md` — 单图动漫 KV / 轻小说封面 / IP 海报
- `character-relationship-diagram.md` — 角色关系图海报（卡片 + 关系连线 + 图例）
- `recipe-process-flowchart.md` — 食谱 / 教程 / 流程步骤图（编号 + 插图 + 说明）
- `product-tvc-storyboard.md` — 产品 TVC 商业广告分镜板（9-panel 实拍质感 + 镜头描述 + 时长）
- `cinematic-storyboard-grid.md` — **电影感叙事分镜** contact sheet（3×4 / 4×4，连续叙事 + cinematic still）
- `process-photo-board.md` — 真人 cinematic 流程板（装备穿戴 / 化妆 / 训练 / 操作分解，编号 + 步骤递进）

## 12. Grids & Collages (`references/grids-and-collages/`)

适合"多面板网格 / 拼贴 / 立项 board"类视觉。当前已落地：

- `banner-grid-2x2.md` — 2×2 营销 banner 套装（一次出 4 张统一系列设计）
- `lookbook-grid.md` — 7 日 lookbook / 9 宫 self-care / TOP N 清单图
- `mixed-style-multi-panel.md` — 多风格混合拼贴（同一主体不同画风演绎）
- `anime-pitch-board.md` — 动漫 / 游戏 / 影视立项 pitch board（KV + 角色 + 世界观 + 文案）
- `ad-banner-multi-grid.md` — 多行业 / 多主题混合广告 banner 网格（每格独立行业 + 风格 + 文案）

## 13. Branding & Packaging (`references/branding-and-packaging/`)

适合"品牌识别系统 / 吉祥物 / 包装设计"类视觉。当前已落地：

- `brand-identity-board.md` — 品牌识别系统板（logo + 配色 + 字体 + 应用 mockup）
- `mascot-brand-kit.md` — 吉祥物多面板品牌识别套装（主形象 + 三视图 + 表情 + 应用）
- `cosmetic-packaging.md` — 化妆品 / 护肤品 单瓶 / 系列 / 礼盒包装
- `beverage-label-design.md` — 饮料 / 食品 / 调味品标签设计（国潮 / 日式 / 西式）
- `full-mascot-brand-doc.md` — **18+ 模块大型品牌识别 + 吉祥物全流程文档**（DNA / moodboard / 草图 / 线稿 / 3D / 配色 / 材质 / 应用一图概览）
- `character-merch-board.md` — IP 角色 + 周边 / 包装 / 海报 / 社交 profile 多元素综合品牌板

## 14. Typography & Text Layout (`references/typography-and-text-layout/`)

适合"字面优先 / 双语版式"等"以文字为主视觉"的类型。当前已落地：

- `title-safe-poster.md` — 大字主张型海报（日式高能量 / 瑞士极简 / 复古印刷）
- `bilingual-layout-visual.md` — 中英 / 中日双语版式视觉（文化 / 学术 / 跨文化品牌）
- `conceptual-typography-poster.md` — 概念字体海报（文字即画面主体）
- `city-creative-font.md` — 城市名创意字体设计（城市名 + 地域文化元素深度融合，如"杭州"内嵌西湖断桥+龙井茶叶）

## 15. Assets & Props (`references/assets-and-props/`)

适合"图标集 / 游戏截图"等"成套素材 / 游戏资产"类视觉。当前已落地：

- `retro-skeuomorphic-icons.md` — 拟物 / Y2K / 像素 图标集（成套统一风格）
- `game-screenshot-mockup.md` — 游戏内截图 mockup（HUD + 字幕 + 任务面板）

## 16. Academic Figures (`references/academic-figures/`)

适合"论文 / 顶会投稿 / 学术海报 / 答辩 PPT / 开题答辩 / 期刊投稿 Graphical Abstract"的配图。整体偏白底 + 出版物字体 + 几何精确 + 低饱和工程色（深蓝 / 灰蓝 / 黑灰为主，≤3 主色）+ 可单色印刷。**严格禁止虚构定量数据**（数值 / 等值线 / 色标范围 / 公式）。

CS / CV / ML 方向：

- `method-pipeline-overview.md` — 方法总览图 / pipeline figure（多 stage 块 + 数据流；变体 4 提供工程类左/中/右 三段式技术路线图）
- `neural-network-architecture.md` — 神经网络架构图（layer 块 + tensor shape + 跳连）
- `qualitative-comparison-grid.md` — 多方法 qualitative 对比网格（**行 = 样本，列 = 方法**）

工程 / 自然科学 / 答辩通用：

- `scientific-schematic.md` — 概念 / 原理 / 实验装置示意图（自由度高，自然语言模板）
- `mechanism-diagram.md` — 机理示意图 / 因果链路 / 转化路径（中心对象 + 多阶段转化 + 结果区；含三段式因果链 / 循环自激发 / 多分支竞争 三种变体）
- `multi-condition-comparison.md` — **多工况 / 多条件结果对比图**（同一对象在不同 condition 下的并列结果，2×2 / 1×N / M×N；强调 panel 间严格统一）
- `publication-chart.md` — publication-ready 数据图表（bar / line / scatter / heatmap / box）

总览 / 摘要 / 答辩首页：

- `graphical-abstract.md` — 期刊投稿 Graphical Abstract / 图形摘要（横向 4 段式 / 中心展开 / 方形 / 竖版四种变体）
- `research-overview-poster.md` — 开题 / 答辩 / 汇报首页研究总览图（上中下三层 + 五模块；含中心辐射 / 左右双栏 / 极简 三种变体）

> 选择策略：CS/CV/ML 论文首选 `method-pipeline-overview` + `qualitative-comparison-grid`；工程 / 能源 / 化工 / 材料方向首选 `method-pipeline-overview` 变体 4 + `mechanism-diagram` + `multi-condition-comparison`；投稿期刊摘要图用 `graphical-abstract`；答辩 PPT 首页用 `research-overview-poster`。

## 17. Infographics (`references/infographics/`)

适合"信息图 / 高密度科普 / 手绘信息图 / KPI 仪表盘"等"信息可视化大图"。当前已落地：

- `legend-heavy-infographic.md` — 高图例密度科普 / 因果链 / 演化 / 解剖图（双语）
- `hand-drawn-infographic.md` — **手绘风**信息图（macaron / morandi / 黑板 / 牛皮纸；自然语言模板）
- `bento-grid-infographic.md` — 便当格模块化信息图（高密度多模块 widget 排布）
- `comparison-infographic.md` — 二元 / 多元对比信息图（A vs B / 套餐档位 / 误区 vs 正解）
- `step-by-step-infographic.md` — 步骤教程信息图（插画感、温暖；非工程流程图）
- `kpi-dashboard-infographic.md` — KPI 仪表盘式信息图（年度回顾 / Wrapped / 业务 dashboard）
- `scientific-scale-zoom.md` — 科学尺度缩放信息图（宏观 → 微观 → 纳米逐级放大）

## 18. Technical Diagrams (`references/technical-diagrams/`)

适合"系统架构 / 流程 / 时序 / 状态机 / ER / 思维导图 / 网络拓扑"等工程示意图。统一暗色 grid 背景 + 等宽字体 + 角色编码配色，每个模板都附 light 变体。

⚠️ 注意：本目录生成的是 **PNG 位图**，**不是可编辑 SVG**；需要可编辑请改用 mermaid / draw.io / excalidraw / Figma。当前已落地：

- `system-architecture.md` — 系统架构图（前端 + 后端 + DB + 缓存 + 队列 + 外部）
- `flowchart-decision.md` — 流程图 / 决策图（BPMN 形状语义 + Yes/No 分支）
- `sequence-diagram.md` — 时序图（actor + lifeline + 消息箭头 + 激活条）
- `state-machine.md` — 状态机 / 生命周期图（state + transition + guard / action）
- `er-diagram.md` — ER 图 / 数据模型图（实体 + 字段 + PK/FK + crow's foot 关系）
- `mind-map-tech.md` — 技术主题思维导图（中央 + 放射式分支）
- `network-topology.md` — 网络拓扑图（设备 glyph + zone / VPC + 带宽 / 协议标）
