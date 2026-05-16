# 游戏内截图 Mockup 模板

本文件用于"伪造一张游戏内截图"的视觉：

- 开放世界游戏截图
- RPG 战斗截图
- 像素 / 体素游戏截图
- 视觉小说截图
- 游戏 UI mockup

特征：

- 整体看起来"像真实游戏内画面"
- 含游戏 UI（HUD / 任务面板 / 血条 / 小地图）
- 有视角语言（第一人称 / 第三人称 / 俯视 / 等距）
- 强调游戏感而非纯插画
- 通常带文字气泡 / 任务提示

## 适用范围

- 游戏内截图 mockup
- 游戏宣传图（伪截图）
- 游戏立项 demo 视觉
- 直播缩略图（伪游戏画面）

## 何时使用

- 用户提到"游戏截图 / game screenshot / mockup / HUD / UI"
- 用户希望"看起来像游戏画面"而不是插画

不要使用：

- 动漫 KV（用 `storyboards-and-sequences/anime-key-visual.md`）
- 游戏立项 pitch（用 `grids-and-collages/anime-pitch-board.md`）
- 角色设定（用 `portraits-and-characters/character-sheet.md`）

## 缺失信息优先提问顺序

1. 游戏类型（开放世界 / RPG / 像素 / 视觉小说 / 模拟）
2. 视角（第一人称 / 第三人称 / 俯视 / 等距）
3. 场景（户外 / 室内 / 城市 / 战斗）
4. 主角描述（如有）
5. UI 元素（HUD / 血条 / 任务 / 小地图）
6. 比例

## 主模板：开放世界游戏截图

📖 描述

整体一张图，模拟真实游戏内截图，含 HUD UI。

📝 提示词

```json
{
  "type": "开放世界游戏截图",
  "goal": "生成一张看起来像真实游戏内截图的视觉",
  "game_meta": {
    "game_name": "{argument name=\"game name\" default=\"FROZEN FANTASIA\"}",
    "engine_feel": "{argument name=\"engine feel\" default=\"现代 3A 引擎（接近 Unreal 5 渲染）\"}",
    "perspective": "{argument name=\"perspective\" default=\"第三人称越肩\"}"
  },
  "scene": {
    "environment": "{argument name=\"environment\" default=\"雪原 + 远景城堡 + 极光\"}",
    "time_of_day": "{argument name=\"time\" default=\"黄昏\"}",
    "weather": "{argument name=\"weather\" default=\"细雪\"}",
    "lighting": "{argument name=\"lighting\" default=\"冷蓝主光 + 暖金边缘光\"}"
  },
  "character": {
    "description": "{argument name=\"character\" default=\"少女主角，银白长发，背身，正在拔剑\"}",
    "position": "画面下三分之一，背身朝远景"
  },
  "ui_elements": {
    "hud": {
      "enabled": "{argument name=\"hud enabled\" default=\"true\"}",
      "items": [
        "{argument name=\"hud item 1\" default=\"左下：血条 + 蓝条 + 角色头像\"}",
        "{argument name=\"hud item 2\" default=\"右下：技能槽 4 格 + 物品栏\"}",
        "{argument name=\"hud item 3\" default=\"左上：小地图（圆形）+ 当前坐标\"}",
        "{argument name=\"hud item 4\" default=\"右上：任务追踪 - '寻找春之源'\"}"
      ]
    },
    "subtitle": {
      "enabled": "{argument name=\"subtitle enabled\" default=\"true\"}",
      "speaker": "{argument name=\"speaker\" default=\"狐狸伙伴\"}",
      "text": "{argument name=\"subtitle text\" default=\"前面就是冰封峡谷了，要小心\"}"
    },
    "interaction_prompt": {
      "enabled": "{argument name=\"prompt enabled\" default=\"true\"}",
      "text": "{argument name=\"prompt\" default=\"按 [E] 调查\"}"
    }
  },
  "style": {
    "rendering": "{argument name=\"rendering\" default=\"PBR 渲染 + 高动态范围 + 微微胶片噪点\"}",
    "color_palette": "{argument name=\"color palette\" default=\"冰蓝 + 月白 + 暖金\"}"
  },
  "aspect_ratio": "{argument name=\"aspect ratio\" default=\"16:9\"}",
  "constraints": {
    "must_keep": [
      "看起来像游戏内截图（有真实 HUD）",
      "HUD 与场景颜色不冲突",
      "字幕字体与 HUD 字体统一",
      "主角与场景比例正确"
    ],
    "avoid": [
      "看起来像静态插画（无 HUD）",
      "HUD 元素塞 > 8 个",
      "UI 风格混杂（像素 + 现代 同框）",
      "字幕过长 / 错字"
    ]
  }
}
```

### 参数策略

- 必问：游戏类型、视角、场景
- 可默认：UI 元素、字幕、配色
- 可随机：环境细节

### 自动补全策略

- 用户给游戏概念时：自动决定视角 / HUD / 字幕
- 默认 16:9
- 默认现代 3A 渲染

## 变体 1：像素游戏截图

📝 提示词

```json
{
  "type": "像素游戏截图",
  "game_meta": {
    "engine_feel": "16-bit JRPG 风（如圣剑传说 3）",
    "perspective": "俯视 / 等距"
  },
  "style": {
    "rendering": "像素艺术 + 16 色调色板",
    "color_palette": "16 色复古 RPG 调色"
  },
  "ui_elements": {
    "hud": {
      "items": ["底部对话框 + 角色立绘"]
    }
  },
  "constraints": {
    "must_feel": "FC / SNES JRPG"
  }
}
```

## 变体 2：视觉小说截图

📝 提示词

```json
{
  "type": "视觉小说截图",
  "game_meta": {
    "engine_feel": "Galgame / Visual Novel",
    "perspective": "第一人称（看角色）"
  },
  "ui_elements": {
    "hud": null,
    "subtitle": {
      "enabled": true,
      "speaker": "{argument name=\"speaker\" default=\"女主角\"}",
      "text": "..."
    }
  },
  "style": {
    "rendering": "anime 半厚涂 + 柔光"
  },
  "constraints": {
    "must_feel": "VN 标准对话场景"
  }
}
```

## 变体 3：自动补全模式

📝 提示词

```json
{
  "type": "游戏截图自动补全",
  "mode": "auto-fill",
  "rule": "用户给一句游戏概念，自动决定视角 / 场景 / HUD / 主角",
  "constraints": {
    "must_feel": "可作为 Steam 商店截图"
  }
}
```

## 变体 4：Minecraft 体素风格品牌环境

适用于以 Minecraft 风格渲染真实品牌/公司的虚拟空间，含品牌标识、文档、HUD 元素。

📝 提示词

```json
{
  "type": "Minecraft 体素风格品牌环境截图",
  "goal": "以 Minecraft 第一人称视角展示一个真实品牌的虚拟空间",
  "environment": {
    "location": "{argument name=\"location\" default=\"Claude Headquarters\"}",
    "architecture": "方块体素风格的办公室建筑",
    "branding": "{argument name=\"brand elements\" default=\"墙上 Claude logo、桌面上机密文件\"}"
  },
  "props": {
    "held_item": "{argument name=\"held item\" default=\"手持一份文件，标题为 Internal Document\"}",
    "desk_items": "{argument name=\"desk items\" default=\"显示器、键盘、文件\"}"
  },
  "hud": {
    "enabled": true,
    "items": ["Minecraft 标准 HUD：物品栏、血条、饥饿值", "聊天栏文字"]
  },
  "style": {
    "rendering": "Minecraft 像素方块风格",
    "lighting": "像素化光照 + 简单阴影"
  },
  "text_content": {
    "readable_text": "{argument name=\"text on documents\" default=\"文件标题和关键文字必须可读\"}"
  },
  "constraints": {
    "must_keep": [
      "体素方块风格一致",
      "品牌标识清晰可辨",
      "HUD 元素完整",
      "文件上的文字可读"
    ],
    "avoid": [
      "混入非 Minecraft 的渲染风格",
      "文字变成乱码",
      "品牌标识变形"
    ]
  }
}
```

## Exemplars from research collection

以下是来自社区的真实使用案例：

**科技领袖吃鸡大厅截图**
> Prompt: "Create a realistic battle royale lobby screenshot with four recognizable tech leaders standing side by side as playable characters. Include a polished game interface, party status panels, buttons, rank badges, and bright background lighting that feels like a live multiplayer game menu."
> 要点：名人在游戏场景中的恶搞用法。需要保持人物面部辨识度，同时游戏 UI 必须完整真实。

**二次元角色手机游戏 / 角色主页截图（1 条）**
> - "生成一张温柔治愈系二次元女孩的手机截图，像真实游戏 App 中的角色主页。"
> 要点：当截图更偏二次元 / 手游角色页时，要先锁“这是游戏中的哪一屏”：主页、战斗、剧情、任务、角色展示。不要只画漂亮角色却没有 screen grammar。

**视觉小说 / 对话框场景（1 条）**
> - "生成带角色立绘、对白框、选项按钮的视觉小说游戏截图。"
> 要点：这类 case 的关键是对话框、名字条、选项按钮和屏幕安全区。它不是封面，也不是角色设定板，而是非常典型的实机界面。

### 吸收规则（游戏资产大类）

- 实机截图、HUD、游戏菜单、角色大厅、对话框场景 → 吸收进本模板
- 单张游戏主视觉 / 卡面 / 封面 → 改走 `anime-key-visual.md`
- 角色设定页 / 动作参考表 / 服装武器 sheet → 改走 `character-sheet.md` 或 `pose-reference-sheet.md`
- 游戏立项整合板 / 玩法+角色+世界观单页 → 改走 `anime-pitch-board.md`

## 避免事项

- 不要让 HUD 元素超过 8 个
- 不要让 UI 风格与游戏类型脱节（像素游戏不应有现代毛玻璃 HUD）
- 不要让字幕超过 2 行
- 不要让主角占画面过大压过 HUD
- 不要让"截图"看起来像静态插画（HUD 是关键标识）
- 不要让任务面板出现明显错字 / 乱码
