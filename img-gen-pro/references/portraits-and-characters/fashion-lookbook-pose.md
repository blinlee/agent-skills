# 时尚穿搭姿态引导模板

本文件用于生成"以特定穿搭 + 姿态方向为核心"的时尚人像图。重点不是拍产品图，而是通过极简姿态指令让模型输出有风格感的穿搭人像，适合社媒传播、Lookbook 和风格参考。

代表案例：

- Pinterest 风格穿搭照（单袖穿法、包袋姿态）
- 街拍风格抓拍（走路、回头、倚靠）
- 时尚杂志感半身照

## 适用范围

- 时尚 / 穿搭社媒内容
- Lookbook 风格参考图
- 穿搭博主内容配图
- 服装品牌风格视觉
- Pinterest / 小红书风格传播图

## 何时使用

- 用户提到"穿搭照 / lookbook / 风格参考 / Pinterest 风"
- 用户关注的是"姿态 + 穿搭组合"而不是服装产品本身
- 用户给出的是极简姿态指令（如"单袖穿法""拎包靠墙"）

不要使用：

- 用户要的是服装白底产品图（用 `white-background-product.md`）
- 用户要的是电商模特图（用 `ecommerce-marketing-board.md`）
- 用户要的是专业肖像照（用 `professional-portrait.md`）

## 缺失信息优先提问顺序

1. 人物描述（性别、年龄段、发型、体型）
2. 穿搭内容（上装、下装、鞋、配饰）
3. 姿态方向（站立/坐姿/行走/倚靠/特写动作）
4. 拍摄风格（街拍/棚拍/胶片/手机随拍/Pinterest 风）
5. 场景背景（纯色/街头/室内/户外）
6. 比例（9:16 竖版 / 3:4 / 1:1）

## 主模板：极简姿态 + 穿搭指令

📖 描述

用极简文字描述穿搭姿态，让模型自行补全构图、光线和氛围。核心是"姿态指令 + 穿搭关键词"，不需要写完整的场景描述。

📝 提示词

```text
Ref: outfit/combo - {argument name="gender" default="Woman"}.
{argument name="style vibe" default="Pinterest vibe"} - {argument name="pose direction" default="cool pose"}.
The {argument name="gender" default="woman"} should be {argument name=\"specific pose\" default=\"wearing only one sleeve of her jacket\"}, and she should be {argument name=\"prop interaction\" default=\"holding the bag with that same arm\"}.
```

### 参数策略

- 必问：性别、穿搭风格关键词、核心姿态动作
- 可默认：风格氛围（Pinterest / 街拍 / 胶片）
- 可随机：背景场景、光线方向、配饰细节

### 自动补全策略

当用户只给出"穿搭风"时：

- 默认 Pinterest 风格：干净背景、自然光、松弛感
- 姿态默认：站姿微侧、一只手自然垂放或拿包
- 穿搭默认：当季流行混搭

## 变体 1：街拍抓拍风格

📝 提示词

```text
Street photography, {argument name="gender" default="young woman"} walking on {argument name="location" default="a rainy Tokyo street at night"}.
Outfit: {argument name="outfit" default="oversized trench coat, white sneakers, crossbody bag"}.
Pose: mid-stride, hair caught by wind, looking away from camera.
Style: {argument name="photo style" default="35mm film grain, warm streetlamp light, shallow depth of field"}.
```

## 变体 2：杂志感棚拍

📝 提示词

```json
{
  "type": "时尚杂志半身照",
  "subject": "{argument name=\"model description\" default=\"年轻东亚女性，短发，自信表情\"}",
  "outfit": "{argument name=\"outfit\" default=\"黑色高领毛衣 + 金色耳环\"}",
  "pose": "{argument name=\"pose\" default=\"双手交叉胸前，微微仰头\"}",
  "style": {
    "lighting": "{argument name=\"lighting\" default=\"侧光，另一半脸在阴影中\"}",
    "background": "{argument name=\"background\" default=\"纯灰色\"}"
  },
  "output": {
    "aspect_ratio": "3:4",
    "quality": "magazine editorial quality"
  }
}
```

## 变体 3：多穿搭对比图

📝 提示词

```json
{
  "type": "穿搭对比九宫格",
  "layout": "3x3 grid",
  "subject": "同一个人，9 种不同穿搭",
  "style": "Pinterest 统一白色背景、自然光",
  "each_cell": {
    "content": "半身或全身穿搭照",
    "consistency": "同一人、同一光线、同一背景"
  },
  "text_overlay": {
    "enabled": true,
    "content": "{argument name=\"labels\" default=\"每格底部小字标注穿搭关键词\"}"
  }
}
```

## 避免事项

- 不要写过于详细的场景描述，极简指令反而效果更好
- 不要把姿态写成"站立微笑看镜头"这种默认姿势，要有具体的动作感
- 不要忽略服装和姿态的互动关系（衣服怎么穿、包怎么拿）
- 不要让背景抢走穿搭主体的注意力
- 不要在同一张图里塞太多风格标签（胶片 + Pinterest + 街拍 = 四不像）
- 不要忘记手指、头发、衣服褶皱这些容易穿帮的细节

## Text QA Inspection Zones

- 如有文字叠加（穿搭标签、品牌名）：必须清晰可读
- 如有社交媒体 UI 元素：必须准确模拟目标平台样式

## Hybrid retrieval metadata（Phase 1 pilot）

- Associated template IDs: `fashion-lookbook-pose`
- Retrieval styles: `Photography`, `Realistic`
- Retrieval scenes: `Fashion`, `Social`
- Curated example cases: none yet
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=fashion-lookbook-pose]`
