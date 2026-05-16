# 街头纪实瞬间摄影模板

本文件用于生成“手机纪实 / 街头抓拍 / 意外现场瞬间”的写实摄影图：

- 意外泼洒瞬间
- 路边散落物品现场
- 街头日常抓拍
- 非摆拍的手机纪实图
- 具有生活痕迹的真实现场

特征：

- 手持手机视角
- 日常现场感
- 材质真实
- 不完美但可信
- 反棚拍、反海报化

## 适用范围

- 街头纪实照片
- 手机随手拍现场
- 泼洒 / 事故痕迹 / 杂乱瞬间
- 真实生活感摄影

## 何时使用

- 用户提到“candid / documentary / 手机纪实 / spilled drink / street moment / accident moment”
- 重点是可信的日常现场，而不是商业广告构图
- 希望有生活痕迹、瑕疵、阴影和材质细节

不要使用：

- 电影概念大片（用 `scenes-and-illustrations/concept-scene.md`）
- 分镜板（用 `storyboards-and-sequences/cinematic-storyboard-grid.md`）
- 品牌 campaign 海报（用 `poster-and-campaigns/campaign-kv.md`）

## 缺失信息优先提问顺序

1. 事件是什么（泼洒 / 跌落 / 打翻 / 路边痕迹）
2. 主体是什么（杯子 / 饮料 / 物品 / 人物动作痕迹）
3. 场景地点（石砖路 / 便利店门口 / 地铁口 / 路边）
4. 光线（正午强光 / 阴天 / 夜间路灯）
5. 机位（俯拍 / 低角度 / 斜拍）
6. 比例（9:16 / 3:4 / 4:5）
7. 是否允许人物影子或路牌影子进入画面

## 主模板：手机纪实街头瞬间

📖 描述

生成一张像真实手机随手拍到的街头纪实照片，重点是事件痕迹、材质、光线和非摆拍感。

📝 提示词

```json
{
  "type": "Documentary Street Moment",
  "goal": "生成一张可信的日常纪实摄影图，看起来像真实手机随手拍到的街头瞬间",
  "event": {
    "moment": "{argument name=\"moment\" default=\"a spilled iced matcha drink on pavement\"}",
    "primary_subject": "{argument name=\"primary subject\" default=\"a transparent plastic cup lying on its side inside the green puddle\"}",
    "detail_traces": "{argument name=\"detail traces\" default=\"scattered ice cubes, foam bubbles, liquid spreading naturally, slight dirt and imperfect splash edges\"}"
  },
  "environment": {
    "location": "{argument name=\"location\" default=\"outdoor stone pavement in an urban street setting\"}",
    "surface": "{argument name=\"surface\" default=\"rough square floor tiles with visible wear and texture\"}",
    "ambient_elements": "{argument name=\"ambient elements\" default=\"a dark human shadow crossing part of the scene, subtle street context outside the frame\"}"
  },
  "camera": {
    "device": "{argument name=\"device\" default=\"handheld smartphone camera\"}",
    "angle": "{argument name=\"angle\" default=\"slightly top-down vertical framing\"}",
    "feel": "{argument name=\"camera feel\" default=\"raw unedited phone photo, natural framing, no polished ad composition\"}"
  },
  "lighting": {
    "time": "{argument name=\"time\" default=\"strong midday sunlight\"}",
    "shadow_logic": "{argument name=\"shadow logic\" default=\"harsh realistic shadows aligned with the light direction\"}"
  },
  "style": {
    "rendering": "{argument name=\"rendering\" default=\"ultra-realistic documentary photography, authentic everyday texture, natural color response\"}",
    "aspect_ratio": "{argument name=\"aspect ratio\" default=\"9:16\"}"
  },
  "constraints": {
    "must_keep": [
      "the scene must feel accidental, not staged",
      "liquid physics and shadows must look believable",
      "surface texture must remain detailed",
      "overall image should feel like a phone capture, not a poster"
    ],
    "avoid": [
      "anime or illustration styling",
      "studio lighting",
      "overly perfect composition",
      "fake liquid, floating ice, duplicated objects, visible brand logos"
    ]
  }
}
```

### 参数策略

- 必问：事件、主体、场景地点
- 可默认：机位、阴影逻辑、材质细节
- 可随机：轻微路人影子、边缘脏污、碎屑

### 自动补全策略

- 默认为手机手持视角，不走商业相机棚拍语言
- 未指定时优先保留真实杂乱和生活痕迹
- 阴影方向与地面材质必须一起补全，避免“假现场感”

## 变体 1：人物动作主导的街头抓拍

📝 提示词

```json
{
  "type": "Candid Street Action Moment",
  "event": {
    "moment": "{argument name=\"moment\" default=\"someone turning abruptly and dropping a takeaway coffee\"}"
  },
  "camera": {
    "angle": "slightly low-angle handheld framing with subtle motion blur"
  },
  "constraints": {
    "must_feel": "documentary, fast, imperfect, believable"
  }
}
```

## Exemplars from research collection

以下是来自社区的真实使用案例：

**Sam Altman 滑板场抓拍**
> Prompt: "Sam Altman on a skateboard at a skatepark with no people."
> 要点：极简 prompt + 名人 + 日常场景。模型需要补全滑板场环境、光线、人物姿态。无人场景增加了构图自由度。

## 避免事项

- 不要做成精修商业海报
- 不要把现场打磨得过于干净
- 不要出现不合理液体边缘或悬浮碎冰
- 不要让构图像摄影比赛样片一样“过度设计”

## Hybrid retrieval metadata（Phase 1）

- Associated template IDs: `street-accident-moment`, `realistic-photography`
- Retrieval styles: `Photography`, `Realistic`
- Retrieval scenes: `Travel`, `Social`, `Fashion`, `Commerce`
- Retrieval tags: `Photography`, `Realistic`, `Scene`, `Lens`
- Curated example cases: `376`, `377`
- Crosswalk source: `data/template-crosswalk.json`
- Prompt source: `data/prompt-intelligence-index.json#templates[id=street-accident-moment]`
