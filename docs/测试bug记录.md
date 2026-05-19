# 测试bug记录

## 一、测试背景

- **文档标题**：数据获取问题记录
- **记录日期**：2026-05-18
- **记录时区**：Asia/Shanghai
- **测试对象**：`invest-analysis-pro`
- **测试场景**：按 Skill 约定的默认 `specialist` 工作流，对 **中国卫星（600118）** 进行一次完整分析流程验证
- **测试目的**：核查在真实运行中，数据抓取链路是否稳定，是否存在外部站点拒绝/限流、接口超时、响应格式异常、字段缺失、降级回退，以及哪些字段缺失属于业务上正常无数据，哪些属于本应可得但本轮未成功取得

### 本次实际执行的主要命令

```bash
python main.py invest-analysis-pro bundle 600118 --include quote,history,technical,ma,volume,pattern,fundamentals,capital-flow,boards,lhb --limit 20
python main.py invest-analysis-pro news 600118 --stock-name 中国卫星 --limit 5
python main.py invest-analysis-pro intel 600118 --stock-name 中国卫星 --limit 5
python main.py invest-analysis-pro strategies list
python main.py invest-analysis-pro strategies show bull_trend
python main.py invest-analysis-pro strategies show shrink_pullback
```

### 本次总体结论

本次流程**可以跑通**，但并非“全链路健康”。

核心事实如下：

1. **CLI 主干工作流可用**：`bundle / news / intel / strategies` 均能返回结构化结果。
2. **真实数据质量存在明显缺口**：主要集中在情报搜索链路、板块链路、资金流部分子字段、基本面部分成长/机构字段。
3. **存在多处外部数据源异常或拒绝访问**：包括 `429 Too Many Requests`、`403 Forbidden`、`JSON 解析失败`、`RemoteDisconnected`、超时等。
4. **存在正常的降级/回退行为**：例如搜索失败后回退到 `AkShare.stock_news_em`，板块主路径失败后切换 fallback。
5. **存在正常的 compact 截断**：部分列表字段因 `--limit 20` 被裁剪，这不是错误，但会影响主控 Agent 能看到的细节量。
6. **因此本轮分析结论应降置信度**：不是因为流程崩溃，而是因为证据链完整性不足。

---

## 二、问题总表

| 序号 | 环节 | 问题类型 | 现象 / 报错 | 影响范围 | 原因判断 | 严重度 |
|---|---|---|---|---|---|---|
| 1 | `intel` 搜索链路 | 站点限流 | 多个 SearXNG 实例返回 `429 Too Many Requests` | 公告、机构分析、风险排查、业绩预期、行业分析等维度未完整拿到 | 外部站点限流/封控 | 高 |
| 2 | `intel` 搜索链路 | 站点拒绝访问 | `403 Forbidden` | 部分搜索实例不可用 | 外部站点拒绝访问/策略限制 | 高 |
| 3 | `intel` 搜索链路 | 响应格式异常 | `响应JSON解析失败` | 某些实例虽然返回响应，但不能被正常消费 | 外部实例异常/兼容性问题 | 中 |
| 4 | `intel` 搜索链路 | 降级回退 | 最终仅保留新闻 fallback | Intel 维度明显不完整 | 上游搜索失败后进入降级路径 | 高 |
| 5 | `news` 搜索链路 | 搜索失败后回退 | 搜索引擎失败后，切到 `AkShare.stock_news_em` | 新闻能拿到，但来源单一 | 设计内降级逻辑生效 | 中 |
| 6 | `boards` 主路径 | 超时 | `primary board context failed: boards timeout` | 主板块上下文失败，改走 fallback | 接口响应慢/超时 | 中 |
| 7 | `boards` fallback | 回退成功 | `sector ranking fallback used after primary board context failed` | 板块信息可得，但质量和稳定性弱于主链路 | 降级成功 | 低 |
| 8 | 板块排行 | 响应异常 | `efinance 获取板块排行失败: Expecting value: line 1 column 1 (char 0)` | 板块排行不稳定 | 第三方响应为空/格式异常 | 中 |
| 9 | 板块排行 | 连接中断 | `Remote end closed connection without response` | 主源失败，需换源 | 外部接口不稳定 | 中 |
| 10 | `fundamentals.growth` | 字段缺失 | `revenue_yoy / net_profit_yoy / roe / gross_margin = null` | 成长分析不完整 | 本应有机会拿到，但本轮未成功取得 | 中 |
| 11 | `fundamentals.earnings` | 部分数据缺失 | 仅拿到财报摘要，盈利预告/快报无记录 | 业绩前瞻不完整 | 部分属于业务上无记录 | 低-中 |
| 12 | 盈利预告/快报探测 | 无匹配记录 | `No matching rows found...` | 预告/快报维度为空 | 更偏业务上确实无记录，不是接口报错 | 低 |
| 13 | `institution` | 字段部分缺失 | `top10_holder_change = null` | 股东结构分析不完整 | 本应更完整，但本轮只拿到部分 | 中 |
| 14 | `fundamental_context.capital_flow` | 子模块 failed | `capital_flow: failed` | 基本面上下文里的资金维度缺失 | 本应有但没拿到 | 中 |
| 15 | `fundamental_context.boards` | 子模块 failed | `boards: failed` | 基本面上下文里的板块整合缺失 | 本应有但没拿到 | 中 |
| 16 | 独立 `capital-flow` | 部分字段异常 | `stock_sector_fund_flow_rank: JSONDecodeError`、`stock_sector_fund_flow_summary: KeyError` | 仅个股主力净流入可用，板块排行/汇总缺失 | 上游返回异常或解析兼容性问题 | 高 |
| 17 | `quote` | 单字段缺失 | `amount = null` | 实时报价不完整 | 本应有但本轮未拿到 | 低 |
| 18 | `history` / boards 列表 | 正常截断 | 因 `--limit 20` 被截断 | 影响细节可见性，不构成错误 | compact 模式正常行为 | 低 |
| 19 | `lhb` 龙虎榜 | 响应偏慢 | 明细接口耗时约 `16271ms` | 影响整体时延 | API 响应慢，但成功返回 | 中 |
| 20 | `news` | 响应偏慢 | 新闻接口耗时约 `4008ms` | 影响速度但不影响结果 | API 偏慢但正常 | 低 |
| 21 | `bundle` 总体状态 | 证据链不完整 | envelope 为 `partial`，同时有 `errors/warnings` | 主控汇总结论必须降置信度 | 真实反映结果质量，不是误报 | 高 |

---

## 三、详细问题记录

### 1. `intel` 搜索链路出现大面积限流与拒绝访问

#### 1.1 具体表现
本次执行 `intel 600118 --stock-name 中国卫星 --limit 5` 时，搜索链路依赖的多个 SearXNG 实例出现大面积失败。

实际出现的异常包括：

- `429 Too Many Requests`
- `403 Forbidden`
- `响应JSON解析失败`
- “实例可能未启用 JSON 输出，或实例/代理拒绝了本次访问”

从执行日志看，失败的实例包括但不限于：

- `https://search.rhscz.eu`
- `https://searx.tiekoetter.com`
- `https://searx.rhscz.eu`
- `https://search.hbubli.cc`
- `https://searxng.website`
- `https://searx.oloke.xyz`
- `https://search.bladerunn.in`
- `https://priv.au`

#### 1.2 受影响维度
原本 `intel` 应尝试覆盖的多个维度中，除“最新消息”外，其余维度均未正常拿到：

- 公司公告
- 机构分析
- 风险排查
- 业绩预期
- 行业分析

最终结果中明确写明：

> 搜索引擎不可用或无有效结果，本次仅返回个股新闻 fallback；调用方 Agent 不得补编缺失维度。

#### 1.3 影响判断
这意味着：

- `intel` 虽然**任务状态仍为 ok**，但其实际信息密度远低于理想状态。
- 最终分析中“情报层”不能视作完整证据链。
- 所有基于公告、机构观点、行业催化、风险事件的判断，都必须降置信度。

#### 1.4 原因判断
这类问题**不是业务上无数据**，也不是 skill 正常预期的“空结果”，而是**外部检索站点出现限流、封控或返回异常**。

即：

- **有较大概率本应该拿到更多信息**
- 但本轮**没有成功取得**

#### 1.5 归类
- 问题性质：外部站点限流 / 拒绝访问 / 兼容性异常
- 是否业务正常：否
- 是否本应可得：是
- 严重度：高

---

### 2. `news` 链路不是直接成功，而是经过失败后回退

#### 2.1 具体表现
执行 `news 600118 --stock-name 中国卫星 --limit 5` 时，先发生搜索引擎不可用：

- `429 Too Many Requests`
- 多实例搜索失败

随后系统回退到：

- `AkShare.stock_news_em`

最终 `news` 命令成功返回 5 条新闻。

#### 2.2 影响判断
说明 `news` 模块的**韧性较好**，因为 fallback 起效了；但也说明：

- 新闻来源变得更单一
- 搜索引擎提供的跨源、补充型资讯未成功获得

#### 2.3 原因判断
这是**降级成功**，不是完全失败。

- 搜索主路径失败：异常
- fallback 成功：正常

因此它不算“完全拿不到数据”，但算“主路径异常、备路径接管”。

#### 2.4 归类
- 问题性质：主路径失败，fallback 成功
- 是否业务正常：部分正常
- 是否本应更完整：是
- 严重度：中

---

### 3. `boards` 主路径超时，依赖 fallback 补救

#### 3.1 具体表现
在 `bundle` 里，板块上下文出现如下 warning：

- `primary board context failed: boards timeout`
- `sector ranking fallback used after primary board context failed.`

这表明：

1. 主链路板块上下文请求超时
2. 随后系统切换到 fallback
3. fallback 最终返回了可用结果

#### 3.2 影响判断
影响不是“完全拿不到板块信息”，而是：

- 主板块上下文没有按理想路径完成
- fallback 的信息质量、字段完整性、稳定性通常弱于主路径
- 因此板块判断可以用，但要降低确定性

#### 3.3 原因判断
这是典型的**接口慢 / 超时 / 主链路不稳定**问题，不属于业务本身无数据。

#### 3.4 归类
- 问题性质：超时 + 回退
- 是否业务正常：否
- 是否本应可得：是
- 严重度：中

---

### 4. 板块排行抓取存在第三方响应异常和断连

#### 4.1 具体表现
运行日志中出现：

- `efinance 获取板块排行失败: Expecting value: line 1 column 1 (char 0)`
- `东财接口获取行业板块排行失败: ('Connection aborted.', RemoteDisconnected('Remote end closed connection without response'))，尝试新浪接口`

这说明板块排行链路中存在：

1. 某些第三方接口返回空响应/非 JSON 响应
2. 某些连接在服务端直接断开
3. 工具通过备用源继续尝试

#### 4.2 影响判断
会导致：

- 板块排行稳定性下降
- 某些字段可能依赖备用源补齐
- 在个别场景下可能得到“有结果但质量不稳定”的输出

#### 4.3 原因判断
这类问题属于：

- **外部接口不稳定**
- **上游响应格式不可预测**

不是业务正常缺失。

#### 4.4 归类
- 问题性质：第三方源不稳定 / 断连 / 格式异常
- 是否业务正常：否
- 是否本应可得：是
- 严重度：中

---

### 5. `fundamentals.growth` 多个成长性字段为空

#### 5.1 具体表现
在 `fundamentals -> growth` 中，以下字段为 `null`：

- `revenue_yoy`
- `net_profit_yoy`
- `roe`
- `gross_margin`

同时该模块状态为：

- `status: partial`

#### 5.2 影响判断
意味着成长性判断并不完整，尤其会影响：

- 收入增速判断
- 利润增速判断
- ROE 趋势判断
- 毛利率质量判断

虽然财报摘要里能看到部分单期数据，但“结构化成长分析字段”没有完整落出来。

#### 5.3 原因判断
这里不能简单判断为“公司没有这些数据”。更准确的判断是：

- **理论上应该有机会拿到这些字段**
- **但本轮没有成功结构化提取到**

因此应归为“本应可得但未拿全”，而不是“业务正常无数据”。

#### 5.4 归类
- 问题性质：字段缺失
- 是否业务正常：否
- 是否本应可得：大概率是
- 严重度：中

---

### 6. `fundamentals.earnings` 只有部分结果，预告/快报无匹配记录

#### 6.1 具体表现
`fundamentals -> earnings` 中，拿到了：

- 2026-03-31 财报摘要
  - 营收
  - 归母净利润
  - 经营现金流
  - ROE

但在 `earnings_disclosure_probe` 中，对多个日期端点轮询后，结果为：

- `status: no_record`
- `note: No matching rows found in checked date-based AkShare forecast/quick-report endpoints.`

#### 6.2 影响判断
说明：

- 财报摘要层面不是空白
- 但盈利预告/快报层面没有新增结构化记录

这会让“前瞻性业绩判断”弱于理想状态。

#### 6.3 原因判断
这一项要区分两层：

1. **财报摘要**：已拿到，不构成问题
2. **盈利预告/快报**：本轮 checked 后无匹配记录，更像**业务层面确实没有对应记录**，而不是接口报错

所以这一条不能简单记为技术故障，应该标注为：

- **字段为空，但更偏业务真实为空**

#### 6.4 归类
- 问题性质：记录不存在 / 无匹配
- 是否业务正常：是，偏正常
- 是否本应可得：未必
- 严重度：低

---

### 7. `institution` 只拿到部分机构/股东信息

#### 7.1 具体表现
在 `fundamentals -> institution` 中：

- `shareholder_count` 有值
- `top10_holder_change = null`

即只拿到股东户数变化，没有拿到前十大股东变化数据。

#### 7.2 影响判断
这会影响：

- 筹码集中度变化判断
- 大股东/机构持仓变化判断
- 机构行为的中期解读

#### 7.3 原因判断
这更像：

- **本应更完整，但本轮只拿到部分**

不宜直接解释为“业务上没有该数据”。

#### 7.4 归类
- 问题性质：部分字段缺失
- 是否业务正常：否
- 是否本应可得：大概率是
- 严重度：中

---

### 8. `fundamental_context.capital_flow` 和 `fundamental_context.boards` 子模块 failed

#### 8.1 具体表现
在 `fundamental_context.coverage` 中：

- `capital_flow: failed`
- `boards: failed`

但在 bundle 的其他独立模块中，资金流和板块又不是完全没有结果。

#### 8.2 影响判断
这说明：

- 基本面上下文内部整合时，某些子模块没有顺利完成
- 系统整体通过其他独立模块补了一部分结果
- 但 `fundamental_context` 本身并不完整

#### 8.3 原因判断
这是**本应可得但内部整合阶段未成功取得**，不是业务上天然不存在。

#### 8.4 归类
- 问题性质：上下文整合失败
- 是否业务正常：否
- 是否本应可得：是
- 严重度：中

---

### 9. 独立 `capital-flow` 只拿到个股主力净流入，板块排行/汇总字段异常

#### 9.1 具体表现
独立 `capital-flow` 返回：

- `main_net_inflow = 66051008.0`（可用）

但同时出现 errors：

- `stock_sector_fund_flow_rank:JSONDecodeError`
- `stock_sector_fund_flow_summary:KeyError`

对应 `sector_rankings` 中：

- `top_inflow_sectors = []`
- `top_outflow_sectors = []`

#### 9.2 影响判断
说明资金流模块是“**半可用**”：

可用部分：
- 个股级主力净流入

不可用/不完整部分：
- 板块资金流排行
- 板块资金汇总

因此：

- 可以判断个股当日资金承接情况
- 但不能完整判断其在所属板块中的相对地位

#### 9.3 原因判断
属于：

- **本应可得但未成功拿到**
- 原因可能是上游接口结构变化、空响应、解析兼容性不足

#### 9.4 归类
- 问题性质：部分字段解析失败
- 是否业务正常：否
- 是否本应可得：是
- 严重度：高

---

### 10. `quote.amount` 缺失

#### 10.1 具体表现
实时行情 `quote` 返回中：

- `price` 有值
- `change_pct` 有值
- `volume` 有值
- `turnover_rate` 有值
- **`amount = null`**

#### 10.2 影响判断
成交额字段缺失会影响：

- 即时量价分析细节
- 与历史成交额横向对比

不过本轮还有 `history.amount` 可作为补充，因此不是致命缺口。

#### 10.3 原因判断
更像是：

- **该字段本应存在，但本轮实时源未返回或未被映射出来**

#### 10.4 归类
- 问题性质：单字段缺失
- 是否业务正常：否
- 是否本应可得：是
- 严重度：低

---

### 11. `history` 与 boards 列表被 `--limit 20` 截断

#### 11.1 具体表现
warning 明确指出：

- `data.history.data truncated from 60 to 20 items`
- `data.fundamentals.belong_boards truncated from 28 to 20 items`
- `data.fundamentals.boards truncated from 28 to 20 items`
- `data.boards.belong_boards truncated from 28 to 20 items`

#### 11.2 影响判断
这会导致：

- 主控 Agent 看不到全量历史数据
- 只能基于裁剪后的列表做上下文分析
- 某些尾部板块信息不可见

#### 11.3 原因判断
这是 **compact 模式 + `--limit 20` 的预期行为**，不是错误。

因此应明确标注：

- **这是正常截断，不算异常故障**
- 但会影响研究深度和细节可见性

#### 11.4 归类
- 问题性质：正常输出裁剪
- 是否业务正常：是
- 是否本应可得：是，但本轮主动未取全
- 严重度：低

---

### 12. 龙虎榜明细接口成功，但耗时较长

#### 12.1 具体表现
`lhb` 相关来源链显示：

- `akshare.stock_lhb_detail_em` 耗时约 **16271ms**
- `akshare.stock_lhb_jgmmtj_em` 耗时约 **1546ms**

#### 12.2 影响判断
不是结果缺失，而是：

- 拖慢了整个 bundle 的总耗时
- 若多股并发分析，可能成为瓶颈

#### 12.3 原因判断
属于：

- **接口慢，但成功返回**

#### 12.4 归类
- 问题性质：性能偏慢
- 是否业务正常：结果正常
- 是否本应优化：是
- 严重度：中

---

### 13. 新闻接口成功，但速度偏慢

#### 13.1 具体表现
`news` 来源链显示：

- `akshare.stock_news_em` 耗时约 **4008ms**

#### 13.2 影响判断
单次还能接受，但在批量分析下会累计增加耗时。

#### 13.3 原因判断
属于：

- **响应偏慢但正常**

#### 13.4 归类
- 问题性质：性能偏慢
- 是否业务正常：是
- 是否本应优化：可优化
- 严重度：低

---

### 14. `bundle` 最终是 `partial`，这不是误报，而是正确反映了证据质量

#### 14.1 具体表现
虽然 `coverage.ok` 看上去全部成功，但 envelope 仍然给出：

- `status: partial`
- 同时存在 `errors` 与 `warnings`

#### 14.2 影响判断
这点很重要：

- 表面上“模块都返回了”
- 但底层其实发生了很多降级、部分失败、字段缺失和超时

因此 `partial` 是合理的，不应误判为系统判断错误。

#### 14.3 原因判断
这是系统对证据质量的**正确标识**，不是 bug。

#### 14.4 归类
- 问题性质：状态提示准确
- 是否业务正常：是
- 是否异常：否
- 严重度：高（对使用者认知很重要，但不属于系统故障）

---

## 四、字段缺失分类清单

### A. 更偏“业务上确实没有 / 无匹配记录”的字段

| 字段/模块 | 状态 | 判断 |
|---|---|---|
| `earnings_disclosure_probe` 对多个 period 的查询 | `no_record` | 更偏业务上该时间点无对应盈利预告/快报记录 |

### B. 更偏“本应可以拿到，但本轮没有成功拿全”的字段

| 字段/模块 | 现象 | 判断 |
|---|---|---|
| `fundamentals.growth.revenue_yoy` | `null` | 本应可得但未拿全 |
| `fundamentals.growth.net_profit_yoy` | `null` | 本应可得但未拿全 |
| `fundamentals.growth.roe` | `null` | 本应可得但未拿全 |
| `fundamentals.growth.gross_margin` | `null` | 本应可得但未拿全 |
| `institution.top10_holder_change` | `null` | 本应可得但未拿全 |
| `fundamental_context.capital_flow` | `failed` | 本应可得但整合失败 |
| `fundamental_context.boards` | `failed` | 本应可得但整合失败 |
| `capital-flow.sector_rankings` | 空列表 + 解析错误 | 本应可得但未拿到 |
| `quote.amount` | `null` | 本应可得但未拿到 |
| Intel 中公司公告/机构分析/风险排查/业绩预期/行业分析 | 未形成结构化结果 | 本应可得但受外部封控影响未拿到 |

### C. 属于“正常截断，不应视为错误”的项

| 字段/模块 | 现象 | 判断 |
|---|---|---|
| `history.data` | 60 条截到 20 条 | `--limit 20` 正常行为 |
| `boards` / `belong_boards` | 28 条截到 20 条 | `--limit 20` 正常行为 |

---

## 五、对本次 specialist 工作流的实际影响

从工作流角度看，这次不是“跑挂”，而是“**可跑通，但证据质量下降**”。

### 1. 对 Technical Analyst 的影响
较小。

原因：
- `history`
- `technical`
- `ma`
- `volume`
- `pattern`

这些核心模块都拿到了可用结果。

### 2. 对 Intel Analyst 的影响
很大。

原因：
- 绝大部分应有的情报维度未正常拿全
- 实际只剩下新闻 fallback
- 这会导致 Intel 研究明显偏弱

### 3. 对 Fundamentals & Flow Analyst 的影响
中到大。

原因：
- 基本面摘要有，但成长字段不完整
- 机构/股东结构不完整
- 资金流只有部分成功
- 板块上下文走了 fallback

### 4. 对 Risk Officer 的影响
中等。

原因：
- 技术风险可判断
- 资金风险、机构行为风险、公告风险、行业催化风险都不够完整

### 5. 对最终 Decision Synthesis 的影响
显著。

主控 Agent 必须：

- 承认 `partial`
- 披露关键 warnings/errors
- 降低置信度
- 不把当前输出包装成“高确信度投资结论”

---

## 六、最终结论

本次 `invest-analysis-pro` 对中国卫星（600118）的 specialist 工作流测试表明：

### 可确认的事实
1. **主流程可运行**，并能返回可用的结构化 evidence。
2. **系统的降级逻辑有效**，在部分源失败时仍能保留基础可用性。
3. **系统对证据质量的标识基本诚实**，`partial/errors/warnings` 能较真实反映数据问题。

### 暴露出的核心问题
1. **搜索情报链路对外部 SearXNG 实例依赖较重，且当前抗封控能力不足。**
2. **板块与资金流链路存在上游不稳定、超时、空响应、解析失败问题。**
3. **部分基本面结构化字段没有稳定落地，影响成长性和机构结构分析。**
4. **部分字段缺失并非业务上不存在，而是本轮应得未得。**

### 对使用者的实际提醒
如果后续直接拿这类结果做正式研究报告或交易建议：

- **必须先看 envelope 的 `partial/errors/warnings`**
- **不能因为模块“有输出”就默认数据完整**
- **尤其不能把 Intel 维度当成已充分覆盖**

---

## 七、建议的后续动作（记录性质，不代表本次已实施）

1. 为 `intel` 搜索链路建立更稳定的多源策略，降低对公开 SearXNG 实例的单点依赖。
2. 对 `capital-flow` 的 `stock_sector_fund_flow_rank` 和 `stock_sector_fund_flow_summary` 增加更强的容错与 schema 检查。
3. 对 `fundamentals.growth` 与 `institution` 缺失字段做一次专项排查，确认是上游数据源问题、字段映射问题，还是本地结构化逻辑缺口。
4. 对 `boards` 主链路超时增加观测与缓存策略，避免每次都依赖 fallback。
5. 对 `quote.amount` 缺失做字段级排查，确认是源字段缺失还是映射遗漏。
6. 对慢接口（尤其 `lhb`）考虑缓存、超时预算和异步拆分，减少 specialist 总时延。

---

## 八、附注

本记录基于 **2026-05-18** 对 **中国卫星（600118）** 的一次真实运行结果整理，属于一次带真实外部数据源交互的运行观测记录，不是理论推演。

后续若更换数据源、缓存状态、限流状态或网络环境，上述问题的复现概率与严重程度可能变化。

---

# 第二次测试补充记录：特变电工（600089）

## 一、测试背景

- **记录日期**：2026-05-18
- **记录时区**：Asia/Shanghai
- **测试对象**：`invest-analysis-pro`
- **测试场景**：按 Skill 约定的默认 `specialist` 工作流，对 **特变电工（600089）** 进行一次完整分析流程验证
- **测试目的**：复核在另一只 A 股标的上，数据抓取链路是否复现上次暴露的问题；同时记录本轮新增暴露的问题、异常形态、性能瓶颈与字段冲突

### 本次实际执行的主要命令

```bash
python main.py invest-analysis-pro --help
python main.py invest-analysis-pro bundle 600089 --help
python main.py invest-analysis-pro quote 600089
python main.py invest-analysis-pro bundle 600089 --stock-name 特变电工 --days 180 --include quote,history,technical,ma,volume,pattern,chip,fundamentals,capital-flow,boards,lhb,news,intel --limit 8
python main.py invest-analysis-pro strategies list
python main.py invest-analysis-pro technical 600089 --days 120
python main.py invest-analysis-pro technical 600089
python main.py invest-analysis-pro fundamentals 600089 --limit 8
python main.py invest-analysis-pro capital-flow 600089 --limit 8
python main.py invest-analysis-pro ma 600089 --periods 5,10,20,60
python main.py invest-analysis-pro volume 600089
python main.py invest-analysis-pro pattern 600089
python main.py invest-analysis-pro strategies show bull_trend
python main.py invest-analysis-pro strategies show shrink_pullback
python main.py invest-analysis-pro strategies show volume_breakout
```

### 本次总体结论

本次流程同样是**可以跑通，但证据质量明显不完整**，且较上次多暴露出一类新问题：**同一标的在不同分析模块之间出现技术结论口径不一致**。

核心事实如下：

1. **主干 CLI 仍可运行**：`bundle / quote / technical / fundamentals / capital-flow / ma / volume / pattern / strategies` 均能返回结构化结果。
2. **bundle 最终仍为 `partial`**：失败/降级主要集中在 `chip`、`intel`、`capital-flow` 子字段、`boards` 主路径。
3. **外部数据源异常再次大面积复现**：包括 `RemoteDisconnected`、`429 Too Many Requests`、`403 Forbidden`、`响应JSON解析失败`、timeout。
4. **新增暴露“分析口径冲突”问题**：`technical` 给出“多头排列”，而独立 `ma` 给出“空头排列”，且现价实际低于 MA5/MA10/MA20/MA60；这不是普通缺字段问题，而是更高优先级的一致性问题。
5. **存在参数接口不一致问题**：`technical 600089 --days 120` 直接报 `unrecognized arguments: --days 120`，说明命令帮助/调用心智与实际参数支持不完全对齐。
6. **`chip` 模块本轮直接失败**：不是 partial，而是明确返回 `No chip distribution data available for 600089`。
7. **因此本轮不只应降置信度，还应额外警惕“模块间冲突导致的错误叙事”。**

---

## 二、本轮新增问题总表

| 序号 | 环节 | 问题类型 | 现象 / 报错 | 影响范围 | 原因判断 | 严重度 |
|---|---|---|---|---|---|---|
| 1 | `technical` vs `ma` | 分析结论冲突 | `technical` 返回“多头排列”，独立 `ma` 返回“空头排列” | 直接影响趋势判断、策略路由、买卖结论 | 计算口径/时间窗口/规则实现不一致 | 高 |
| 2 | `technical` 命令参数 | 参数不兼容 | `unrecognized arguments: --days 120` | 妨碍调用方稳定构造命令 | CLI 参数设计不统一 | 中 |
| 3 | `history` 主数据源 | 外部连接中断 | 多次 `RemoteDisconnected('Remote end closed connection without response')` | 历史行情主路径不稳定，依赖 fallback | 东财/Efinance 上游不稳定 | 高 |
| 4 | `chip` | 模块失败 | `No chip distribution data available for 600089` | 筹码结构维度完全缺失 | 个股无数据 / 抓取链路失败 / 兼容性问题待排查 | 高 |
| 5 | `capital-flow` | 超时 + 降级 | `capital_flow timeout`，仅保留个股主力流向 fallback | 板块资金流相对位置无法判断 | 子模块超时 / 上游慢 / schema 不稳 | 高 |
| 6 | `intel` 搜索链路 | 多实例限流/拒绝访问 | 429 / 403 / JSON 解析失败大面积复现 | 公告、机构、风险、业绩预期、行业分析缺失 | 外部 SearXNG 依赖脆弱 | 高 |
| 7 | `news` 搜索链路 | fallback 依赖 | 搜索失败后改用 `AkShare.stock_news_em` | 新闻可得，但来源单一 | 设计内降级，主路径不稳 | 中 |
| 8 | `boards` 主路径 | timeout + fallback | `primary board context failed: boards timeout` | 板块强弱判断可信度下降 | 主链路慢 / 外部接口不稳 | 中 |
| 9 | 板块排行 | 响应异常 | `Expecting value: line 1 column 1 (char 0)` | 板块排行链路稳定性差 | 空响应 / 非 JSON 响应 | 中 |
| 10 | `lhb` | 极慢但返回 | `stock_lhb_detail_em` / `stock_lhb_jgmmtj_em` 约 27 秒级 | specialist 总时延被显著拉长 | 上游接口慢 | 中 |
| 11 | `quote` | 单字段缺失 | `amount = null` 再次出现 | 实时量价分析仍不完整 | 源字段缺失或映射遗漏 | 低 |
| 12 | `fundamentals.growth` | 结构化字段缺失 | `revenue_yoy / net_profit_yoy / roe / gross_margin = null` | 成长性判断不完整 | 本应可得但未成功提取 | 中 |
| 13 | `institution` | 字段缺失 | `top10_holder_change = null` | 股东结构分析不完整 | 本应更完整，但本轮未拿全 | 中 |
| 14 | `earnings_disclosure_probe` | 无匹配记录 | 多 period 均 `no_record` | 业绩预告/快报前瞻性不足 | 更偏业务真实无记录 | 低 |
| 15 | `bundle` 总体状态 | 证据链不完整 | `status: partial` 且伴随多项 errors/warnings | 最终研究结论必须降置信度 | 状态标识真实 | 高 |

---

## 三、详细问题记录

### 1. `technical` 与独立 `ma` 的趋势判断出现直接冲突

#### 1.1 具体表现
同一标的、同一轮测试中：

- `technical 600089` 返回：
  - `trend_status = 多头排列`
  - `ma_alignment = 多头排列 MA5>MA10>MA20`
  - `trend_strength = 75`
  - `buy_signal = 买入`
- 但 `ma 600089 --periods 5,10,20,60` 返回：
  - `above_ma_count = 0`
  - `total_ma_count = 4`
  - `ma_alignment = 空头排列`
  - 当前价 `26.92` 低于 `MA5=28.15 / MA10=27.76 / MA20=27.60 / MA60=28.45`

#### 1.2 影响判断
这是本轮最重要的新问题之一，因为它不是普通“字段缺失”，而是**两个分析模块对同一事实给出了方向相反的解释**。

直接影响：

- 技术趋势判断是否可信
- specialist 模式下策略路由是否正确
- `bull_trend / shrink_pullback / volume_breakout` 等策略的前提是否成立
- 最终 buy/hold/sell 倾向是否会被误导

#### 1.3 原因判断
高概率存在以下几类可能：

1. `technical` 与 `ma` 使用的数据区间不同
2. 两者对“多头排列”的定义不同（均线相对位置 vs 当前价相对均线）
3. 某一侧存在规则实现偏差或输出文案误导
4. 历史数据刷新时点不同，导致引用的最新 bar 不一致

在未排查前，不能把它视为正常差异，必须视为**高优先级一致性缺陷**。

#### 1.4 归类
- 问题性质：模块间结论冲突
- 是否业务正常：否
- 是否本应一致：是
- 严重度：高

---

### 2. `technical` 命令不支持 `--days`，参数接口存在不统一

#### 2.1 具体表现
执行：

```bash
python main.py invest-analysis-pro technical 600089 --days 120
```

返回：

- `status: failed`
- `task: argument_error`
- `message: unrecognized arguments: --days 120`

#### 2.2 影响判断
这说明：

- 调用方不能假设分析类命令都支持与 `history` 类似的 `--days`
- CLI 的参数心智模型不统一
- 外部 controller 若自动拼参数，容易直接报错

#### 2.3 原因判断
更偏向：

- CLI 命令设计不一致
- 文档或帮助信息没有足够强调子命令差异

这不一定是数据问题，但确实是**可用性/集成性问题**。

#### 2.4 归类
- 问题性质：接口参数不一致
- 是否业务正常：否
- 是否本应统一：最好统一或显式说明
- 严重度：中

---

### 3. 历史 K 线主数据源再次出现多次 `RemoteDisconnected`

#### 3.1 具体表现
本轮执行中，多次出现类似报错：

- `Eastmoney 历史K线接口失败`
- `RemoteDisconnected('Remote end closed connection without response')`
- `EfinanceFetcher 600089 获取失败`
- `数据源失败 1/5`

涉及的区间包括但不限于：

- `20250523~20260518`
- `20260118~20260518`
- `20250920~20260518`

#### 3.2 影响判断
虽然最终 `history` 仍拿到了 180 条数据，说明 fallback 生效或后续源补齐成功，但这意味着：

- 主数据源并不稳定
- 历史行情并非一次稳定获取
- 某些模块实际建立在“失败后再补救”的链路上

#### 3.3 原因判断
与上次板块/排行类问题类似，属于：

- 外部东财接口不稳定
- efinance 包装层无法完全屏蔽上游中断

#### 3.4 归类
- 问题性质：外部连接中断 / fallback 依赖
- 是否业务正常：否
- 是否本应可得：是
- 严重度：高

---

### 4. `chip` 模块本轮直接失败，筹码分布完全缺失

#### 4.1 具体表现
日志与 bundle 中均显示：

- `获取 600089 筹码分布失败`
- `所有数据源均失败`
- `No chip distribution data available for 600089`

最终 bundle 中：

- `data.chip = {"error": "No chip distribution data available for 600089"}`
- `coverage.failed = ["chip"]`

#### 4.2 影响判断
这意味着：

- 筹码结构、获利比例、平均成本、集中度等维度完全缺失
- `shrink_pullback` 等需要筹码健康度辅助确认的策略无法完整验证
- 最终报告里的 `chip_structure` 只能标 unknown，不能补编

#### 4.3 原因判断
当前不能武断判断是“该股确实无筹码数据”。更稳妥的判断是：

- 可能是个股层面无可用数据
- 也可能是当前筹码抓取链路对该股失败
- 也可能是所有备选数据源均不稳定

在未专项排查前，应归为**高优先级缺口**。

#### 4.4 归类
- 问题性质：模块失败 / 关键维度缺失
- 是否业务正常：未必
- 是否本应可得：大概率是
- 严重度：高

---

### 5. `capital-flow` 只保留个股主力流向，板块资金流维度继续失败

#### 5.1 具体表现
独立 `capital-flow` 返回：

- `main_net_inflow = -572805216.0`
- `inflow_5d = -2324409936.0`
- `inflow_10d = -3381716864.0`

但同时：

- `status = partial`
- `errors = ["capital_flow timeout"]`
- `warnings = ["sector capital-flow rankings unavailable; returned per-stock capital flow fallback."]`
- `sector_rankings.top_inflow_sectors = []`
- `sector_rankings.top_outflow_sectors = []`

#### 5.2 影响判断
可用部分：

- 个股主力净流入/流出
- 5 日与 10 日累计流向

缺失部分：

- 所属板块资金强弱排名
- 板块资金净流入/流出上下文

这会导致：

- 可以判断个股资金承压
- 但不能判断它在板块中的相对位置和共振强度

#### 5.3 原因判断
与上次测试一致，仍偏向：

- 上游接口超时
- 资金流子模块兼容性或容错不足

#### 5.4 归类
- 问题性质：超时 + fallback + 部分字段为空
- 是否业务正常：否
- 是否本应可得：是
- 严重度：高

---

### 6. `intel` 搜索链路再次大面积限流/拒绝访问，仅保留新闻 fallback

#### 6.1 具体表现
本轮再次出现大量：

- `429 Too Many Requests`
- `403 Forbidden`
- `响应JSON解析失败`

涉及实例包括但不限于：

- `https://search.rhscz.eu`
- `https://search.hbubli.cc`
- `https://searx.rhscz.eu`
- `https://searxng.website`
- `https://searx.tiekoetter.com`
- `https://search.bladerunn.in`
- `https://priv.au`
- `https://searxng.site`
- `https://search.sapti.me`

最终 `intel` 结果明确表现为：

- 最新消息来自 `AkShare.stock_news_em`
- 公司公告 / 机构分析 / 风险排查 / 业绩预期 / 行业分析未形成有效结构化结果

#### 6.2 影响判断
这意味着 Intel 维度再次显著残缺。

对最终分析的影响不是“没新闻”，而是：

- 缺少跨源验证
- 缺少公告层和机构层判断
- 缺少专门的风险排查和行业分析维度

#### 6.3 原因判断
与上次结论一致：

- 外部公开 SearXNG 依赖过重
- 当前抗限流/抗封控能力不足

#### 6.4 归类
- 问题性质：外部搜索依赖脆弱 / fallback 依赖
- 是否业务正常：否
- 是否本应可得：是
- 严重度：高

---

### 7. `boards` 主路径 timeout，板块排行仍依赖 fallback

#### 7.1 具体表现
本轮继续出现：

- `primary board context failed: boards timeout`
- `sector ranking fallback used after primary board context failed.`
- `belong_boards fallback failed for 600089: Expecting value: line 1 column 1 (char 0)`
- `东财接口获取行业板块排行失败 ... 尝试新浪接口`

#### 7.2 影响判断
说明板块链路问题具有复现性，而不是偶发现象。

虽然最终仍能返回如：

- 电网设备
- 电力设备
- 输变电设备
- 新疆板块
- 智能电网
- 特高压

但这些结果并不代表主链路健康，只代表 fallback 还在兜底。

#### 7.3 原因判断
同样属于：

- 主路径慢或不稳定
- 备用路径可用，但质量和一致性较弱

#### 7.4 归类
- 问题性质：超时 + 回退 + 响应异常
- 是否业务正常：否
- 是否本应可得：是
- 严重度：中

---

### 8. 龙虎榜接口非失败，但耗时已经进入明显不可忽视区间

#### 8.1 具体表现
本轮来源链显示：

- `dragon_tiger:stock_lhb_stock_statistic_em` 约 `7131ms`
- `akshare.stock_lhb_detail_em` 约 `27462ms`
- `akshare.stock_lhb_jgmmtj_em` 约 `26888ms`

且最终结果为：

- `is_on_list = false`
- `recent_count = 0`
- `details.status = no_record`

#### 8.2 影响判断
这意味着：

- 即使最后只是得到“无记录”，也要付出很高的等待成本
- specialist 全链路时延会被龙虎榜模块显著拖长
- 对批量研究、并行多股研究尤其不友好

#### 8.3 原因判断
属于：

- 上游接口偏慢
- 当前未做足够缓存 / 超时预算控制 / 早停优化

#### 8.4 归类
- 问题性质：性能偏慢
- 是否业务正常：结果正常
- 是否本应优化：是
- 严重度：中

---

### 9. `quote.amount` 与 `fundamentals` 部分字段缺失问题再次复现

#### 9.1 具体表现
本轮继续出现：

- `quote.amount = null`
- `fundamentals.growth.revenue_yoy = null`
- `fundamentals.growth.net_profit_yoy = null`
- `fundamentals.growth.roe = null`
- `fundamentals.growth.gross_margin = null`
- `institution.top10_holder_change = null`

#### 9.2 影响判断
这说明上次暴露的问题并未因为换股而消失，具有一定普遍性：

- 即时报价成交额仍不稳定
- 成长性结构化字段仍落不下来
- 股东结构字段仍不完整

#### 9.3 原因判断
更偏向系统性问题，而非单一个股问题。

#### 9.4 归类
- 问题性质：复现型字段缺失
- 是否业务正常：否
- 是否本应可得：大概率是
- 严重度：中

---

### 10. `bundle=partial` 这次依然是正确标识，而且比上次更应被认真对待

#### 10.1 具体表现
本轮 bundle：

- `coverage.ok` 很多模块仍返回了结果
- 但 `coverage.failed = ["chip"]`
- 同时伴随 `capital-flow`、`boards`、`intel` 多项 warnings/errors
- 最终 envelope 状态为 `partial`

#### 10.2 影响判断
这次的 `partial` 不只是“有些字段少了”，而是同时存在：

- 关键模块失败（chip）
- 关键模块部分成功（capital-flow）
- 主路径降级（boards/news/intel）
- 模块间结论冲突（technical vs ma）

所以本轮 `partial` 的含义比上次更重。

#### 10.3 原因判断
这是系统对真实证据质量的正确反映。

#### 10.4 归类
- 问题性质：状态提示准确
- 是否异常：否
- 对使用者是否重要：极高
- 严重度：高

---

## 四、本轮字段缺失与异常分类补充

### A. 更偏“业务上可能确实没有 / 无匹配”的项

| 字段/模块 | 状态 | 判断 |
|---|---|---|
| `earnings_disclosure_probe` 多个 period | `no_record` | 更偏业务上该时间点无对应记录 |
| `lhb.details` | `no_record` | 更偏近期无龙虎榜记录，不属于抓取失败 |

### B. 更偏“本应可得，但本轮没有成功拿全”的项

| 字段/模块 | 现象 | 判断 |
|---|---|---|
| `chip` | 直接 failed | 大概率本应可得但本轮未成功获取 |
| `capital-flow.sector_rankings` | 空列表 + timeout warning | 本应可得但未拿到 |
| `intel` 多维度情报 | 未形成结构化结果 | 本应可得但被搜索链路封控 |
| `boards` 主路径上下文 | timeout 后 fallback | 本应主路径可得但未成功 |
| `quote.amount` | `null` | 本应可得但未返回 |
| `growth.*` 多字段 | `null` | 本应可得但未结构化成功 |
| `institution.top10_holder_change` | `null` | 本应可得但未拿全 |

### C. 属于“逻辑/实现一致性问题”，不应简单归为缺数据

| 字段/模块 | 现象 | 判断 |
|---|---|---|
| `technical` vs `ma` | 一个多头、一个空头 | 属于分析层一致性缺陷 |
| `technical --days` | 参数直接报错 | 属于 CLI 设计/文档一致性问题 |

---

## 五、对本次 specialist 工作流的实际影响

### 1. 对 Technical Analyst 的影响
中等，不再是“较小”。

原因：

- `history / technical / ma / volume / pattern` 都有结果
- 但 `technical` 与 `ma` 自身冲突

这意味着技术研究不是简单“可用”，而是**可用但内部需先做一致性仲裁**。

### 2. 对 Intel Analyst 的影响
很大。

原因与上次一致，且再次复现：

- 搜索链路大面积失败
- 基本只剩新闻 fallback
- 无法把 Intel 视为完整情报层

### 3. 对 Fundamentals & Flow Analyst 的影响
大。

原因：

- `growth` 关键字段仍缺
- `institution` 仍缺字段
- `capital-flow` 仅个股维度可用
- `chip` 直接失败
- `boards` 依赖 fallback

### 4. 对 Risk Officer 的影响
较大。

原因：

- 不只是“信息不全”
- 还出现“技术模块结论冲突”
- 风险官必须先对证据一致性打折，再讨论投资风险

### 5. 对最终 Decision Synthesis 的影响
显著，而且比上次更严重。

主控 Agent 若不披露这些问题，很容易：

- 误把 `technical` 的“买入”当成高可信信号
- 忽略 `ma` 与资金流给出的相反约束
- 把 partial 结果包装成完整结论

---

## 六、本轮新增暴露出的核心问题

1. **不仅数据源不稳定，分析层本身也可能存在口径不一致。**
2. **筹码模块对部分个股可能完全不可用，当前缺少稳定降级说明。**
3. **CLI 子命令参数设计不统一，会增加 controller 自动化调度成本。**
4. **龙虎榜即使无记录也耗时很重，当前 specialist 模式的性能预算偏紧。**
5. **`partial` 状态下，不同问题的严重性没有被细分排序，调用方仍需自己判断优先级。**

---

## 七、建议的后续动作（基于本轮新增问题补充）

1. 对 `technical` 与 `ma` 做一次**同源同窗口一致性排查**，明确：
   - 两者使用的数据区间是否一致
   - “多头排列”的定义是否一致
   - 当前价跌破 MA 时为什么 `technical` 仍给出“买入”
2. 为 `chip` 模块补充更细的失败分类：
   - 个股确无数据
   - 上游无响应
   - 解析失败
   - 全部备源失败
3. 统一或显式规范 CLI 参数体系，至少说明哪些命令支持 `--days`，哪些不支持。
4. 为 `lhb` 增加更激进的超时预算、缓存或早停机制，避免“无记录也等 20-30 秒”。
5. 在 `partial` 结果中增加**问题优先级排序字段**，帮助 controller 识别“哪些缺陷只是细节缺口，哪些会直接推翻结论”。
6. 持续降低 Intel 对公开 SearXNG 实例的依赖，或将失败维度显式结构化，而不是只在 warning 文本中堆积。

---

## 八、附注

本补充记录基于 **2026-05-18** 对 **特变电工（600089）** 的一次真实运行结果整理，与上文中国卫星测试记录属于同日不同标的、不同运行实例的观测。

两次测试共同说明：

- 问题并非单一标的特例
- 搜索、板块、资金流、部分基本面字段缺失具有复现性
- 本轮新增的“技术结论冲突”问题值得优先排查，因为它会直接污染最终投资结论

---

# 第三次测试补充记录：再升科技（603601）与技能工作流/体验问题

## 一、测试定位

- **记录日期**：2026-05-19
- **记录时区**：Asia/Shanghai
- **测试对象**：`invest-analysis-pro`
- **测试场景**：不是为了验证“再升科技应不应该买”，而是把这次分析过程当作一次**技能端到端测试**，重点观察：
  1. `specialist` 默认 DAG 是否能稳定执行
  2. `bundle` 聚合入口是否足够稳
  3. subagent 多角色分发后，最终输出是否既合规又有人类可读性
  4. 模板、产物契约、用户体验之间是否存在结构性冲突
- **测试目的**：沉淀这次实际执行中暴露出的流程问题、体验问题和技能规范缺口，便于后续修技能，而不是继续讨论股票结论本身。

---

## 二、本轮新增的核心问题（与前两轮不同）

本轮最重要的，不是单一数据字段缺失，而是**技能工作流和输出契约本身暴露出设计缺陷**。

### 核心新增问题

1. **`bundle` 作为默认主入口不够稳，容易被慢源/坏源整体拖垮**
2. **技能没有把“bundle 失败后如何合规降级到分模块取证”写成正式规则**
3. **最终输出契约没有区分“给人看的报告”和“给系统/审计看的工件”**
4. **模板本身是半英文骨架，导致用户可见报告中英文混杂**
5. **`Decision Dashboard JSON` 被机械理解为“必须直接贴给用户”**
6. **当前模板会诱导 agent 为了合规而牺牲人类阅读体验**
7. **执行过程中虽然 DAG 基本跑通，但用户体验层明显不够稳、不够自然**

---

## 三、本轮实际执行过程记录（按时间顺序）

这一段专门记录本轮我是怎么执行的、为什么那样判断、踩了哪些坑。

### 1. 起步阶段：按 skill 要求先读规则，再尝试 bundle 主入口

#### 1.1 实际动作
先读取：

- `SKILL.md`
- `references/evidence-contract.md`
- `references/dag-workflow.md`
- `references/report-standard.md`
- `references/workflow-manifest.json`
- 角色 prompt
- 输出模板和 schema

随后按 skill 推荐路径，优先尝试：

```bash
python main.py invest-analysis-pro bundle 603601 --stock-name 再升科技 --include quote,history,technical,ma,volume,pattern,chip,local-analysis,fundamentals,capital-flow,boards,lhb,news,intel,market --limit 8
```

#### 1.2 当时的判断
这是对 skill 最忠实的启动方式，因为现行规范默认把 `bundle` 视为：

- 证据统一入口
- Evidence Audit 的基础载体
- 后续 DAG 各角色共享的标准 envelope

所以一开始没有理由跳过它。

---

### 2. 第一个关键坑：bundle 被慢源和坏源整体拖死

#### 2.1 实际现象
这个 `bundle` 进程没有干净返回 `ok/partial/failed` 结果，而是在运行过程中被拖得很长，最后进程被 `SIGTERM` 杀掉。

从执行日志看，期间反复出现：

- 历史 K 线接口 `RemoteDisconnected`
- `chip` 数据失败
- `boards` / `capital-flow` fallback 和 timeout
- `intel` 搜索链路大面积 `429 / 403 / 网络失败 / JSON 解析失败`
- 多个慢接口长时间占用总任务时间

#### 2.2 我当时为什么说“bundle 主链路被拖死了”
这里的“拖死”，不是情绪化表达，意思是：

> `bundle` 这个聚合入口把很多慢源、坏源、重试链路绑定到一个总命令里，结果某些外部依赖迟迟不收敛，最终整个总任务被超时/被杀。

#### 2.3 这暴露出的不是单点数据问题，而是技能设计问题
因为如果 skill 默认高度依赖 bundle：

- 任何一个慢模块都会拖总包
- controller 很难快速知道具体是谁坏了
- 一旦总包被杀，Evidence Audit 入口也就一起没了
- 用户体验上就会表现为“整个分析看起来卡住/迟滞/不稳定”

#### 2.4 我当时的判断
我没有继续死磕 bundle，有两个原因：

1. **继续重试 bundle，信息增量不高**，反而只会继续烧时间
2. 这次任务目标是**测试技能稳定性**，不是把 bundle 当宗教入口强撑到底

所以我判断：

> 需要立即切换到分模块取证，把故障颗粒度打散，保留异常明细，不让单一聚合入口继续劫持整个工作流。

---

### 3. 第二步：正式切换到“分模块取证”

#### 3.1 实际动作
我随后分开执行了：

```bash
python main.py invest-analysis-pro quote 603601
python main.py invest-analysis-pro history 603601 --days 180 --limit 30
python main.py invest-analysis-pro technical 603601
python main.py invest-analysis-pro ma 603601 --periods 5,10,20,60
python main.py invest-analysis-pro volume 603601
python main.py invest-analysis-pro pattern 603601
python main.py invest-analysis-pro fundamentals 603601
python main.py invest-analysis-pro capital-flow 603601
python main.py invest-analysis-pro boards 603601
python main.py invest-analysis-pro lhb 603601
python main.py invest-analysis-pro news 603601 --stock-name 再升科技 --limit 5
python main.py invest-analysis-pro intel 603601 --stock-name 再升科技 --limit 5
python main.py invest-analysis-pro chip 603601
python main.py invest-analysis-pro local-analysis 603601
```

#### 3.2 这样做的好处
这一步的收益非常明显：

1. **能明确知道是哪一个模块坏**
2. **坏一个模块不至于拖死全部证据采集**
3. **异常可以逐条记录到测试文档里**
4. 后续 subagent 仍然能拿到足够证据切分角色分析

#### 3.3 但这里也暴露出 skill 规范缺口
当前 skill 没有明确把这条路径定义成正式 fallback。

也就是说，现在的规范更像：
- bundle 是正路
- modular 是临场补救

而本轮测试说明，它应该改成：
- **bundle 优先尝试**
- **bundle 超时 / SIGTERM / mandatory slice 缺失时，自动切换 modular fallback**
- **这种降级是合规行为，不该被视为偏离流程**

这是需要写回 skill 的。

---

### 4. 第三步：DAG 分发基本走通，但依赖人工拼装 payload

#### 4.1 实际动作
拿到分模块证据后，我继续按 `specialist` 默认 DAG 走：

- 并行派发第一层：
  - Technical Analyst
  - Intel Analyst
  - Fundamentals & Flow Analyst
- 等三路回来后，继续派发：
  - Risk Officer
  - bull_trend
  - shrink_pullback
  - volume_breakout

#### 4.2 实际踩坑
这里有两个明显问题：

##### 坑 A：没有现成的结构化 run-record 自动产物
我只能人工从各模块结果里抽关键字段，再手工拼进 subtask payload。

##### 坑 B：subtask payload 模板是对的，但落地成本高
理论上 skill 有 `assets/subtask-payload-template.md`，但实践里 controller 仍然要：

- 自己挑字段
- 自己决定给哪个角色哪些 slice
- 自己压缩 warnings/errors

这说明模板是“格式存在”，但还不够“自动可用”。

#### 4.3 我当时的判断
DAG 本身并没有崩，subagent 路由是可用的；问题主要不在分发机制，而在：

- **证据采集入口不稳**
- **payload 组装自动化不足**
- **最终输出契约不清晰**

---

## 四、用户提出的两个问题，对应的技能层问题归纳

### 问题 1：为什么会出现“bundle 主链路被拖死了，我改成分模块取证”这句话？

#### 归纳后的真实问题
不是一句话表达不好，而是技能设计里存在如下缺陷：

1. `bundle` 被默认视为主入口，但它绑定了太多慢源和坏源
2. skill 没有把 modular fallback 正式化
3. 一旦 bundle 被拖垮，controller 只能临场切换策略
4. 这说明 workflow 设计对 `bundle` 的稳定性假设过强

#### 建议修复方向
在 skill 文档中明确写：

> If `bundle` times out, is terminated, or returns incomplete coverage on mandatory slices, the controller must switch to modular evidence collection. This fallback is compliant behavior, not workflow deviation.

---

### 问题 2：为什么最终报告中英文混杂，还有大段 JSON，显然不人类友好？

#### 归纳后的真实问题
这不是单纯“agent 写作风格不好”，而是模板与输出契约共同诱导出来的。

##### 问题 A：模板骨架天然中英混杂
例如：
- `Executive Summary`
- `Core Conclusion`
- `Battle Plan`
- `decision_type`
- `signal_type`

这会导致用户可见内容天然中英夹杂。

##### 问题 B：`Decision Dashboard JSON` 被定义为 mandatory artifact
但规范没区分：
- **必须生成**
- 和 **必须直接展示给用户**

结果 controller 很容易机械理解为：

> 为了合规，必须把 JSON 原样贴进最终回复。

##### 问题 C：没有区分“用户视图”和“系统工件”
现在的 skill 把三类东西混在一起：

1. 人类阅读的最终报告
2. 机器消费的 JSON
3. 调试/审计用的 evidence appendix

如果三者都硬塞到用户最终消息里，体验一定差。

---

## 五、本轮明确暴露出的模板/规范问题

### 1. 展示层与工件层未分离
应该拆成：

- **User-facing deliverable**：给用户看的最终报告，全中文，自然语言优先
- **Workflow artifacts**：JSON、Evidence Audit、run record，默认不直接 inline 给用户

### 2. 模板标题语言没有统一
用户是中文语境时，应该强制：

- 标题中文化
- 小节中文化
- 解释中文化

英文 schema key 应该只保留在机器工件里。

### 3. JSON 应该“生成”，不应该默认“展示”
这条要写死，否则 agent 会继续机械合规。

### 4. report-standard 对“最终展示顺序”的约束太像调试输出
它现在更像在教 agent 如何生成**验收包**，但没有明确区分**给人看的主报告**和**内部工件包**。

---

## 六、这次我自己的执行层失误/不足

为了便于后续追责和修复，也把我自己的问题写清楚。

### 1. 我对“mandatory artifact”理解得过于字面
我把：
- `Decision Dashboard JSON mandatory`
- `Evidence Audit Appendix mandatory`

过度理解成：
- **必须直接贴给用户**

这导致最终输出太像“合规交付包”，不像“人类友好报告”。

### 2. 我虽然意识到体验差，但当时优先服从了合规
换句话说：

- 我当时的优先级是“先别漏工件”
- 结果牺牲了“最终展示自然度”

如果后续 skill 明确把“生成”和“展示”拆开，这个问题会大幅下降。

### 3. 我在最终阶段没有再做一次“用户体验收口”
如果纯从执行质量说，我本可以在保留 artifact 的前提下再做一次人类可读重写，至少不该直接扔完整 JSON 大块给用户。

这点也应记录为 controller 的一类常见失误。

---

## 七、本轮建议新增到 skill 的修复项

### A. 关于 bundle / modular fallback
建议加到 `evidence-contract.md` 或 `dag-workflow.md`：

1. `bundle` 是优先入口，不是唯一入口
2. 若出现以下任一情况，自动降级 modular fallback：
   - timeout
   - SIGTERM
   - mandatory evidence slice missing
   - source failures exceed threshold
3. modular fallback 属于**合规行为**，不记 workflow deviation

### B. 关于输出分层
建议加到 `report-standard.md`：

#### User-facing deliverables
- full markdown report
- brief summary report
- short message report

#### Workflow artifacts
- decision dashboard json
- evidence audit appendix
- workflow run record

并明确：

> Workflow artifacts are mandatory for workflow completion, but should not be dumped inline in normal user-facing output unless the user explicitly requests debugging or structured output.

### C. 关于语言统一
建议加硬约束：

> User-facing report titles, section names, and prose must use a single language matching the user request. For Chinese users, default to full Chinese. English schema keys belong only to machine-readable artifacts.

### D. 关于模板中文化
建议把展示模板里的：
- Executive Summary
- Evidence Audit
- Core Conclusion
- Battle Plan
- Action Checklist

都改成中文标题。

### E. 关于 controller 的最后一道体验闸门
建议在 checklist 里新增：

- [ ] 用户可见输出是否仍然像“给人看的报告”
- [ ] JSON 是否被错误地直接倾倒给用户
- [ ] 标题和字段是否出现无必要中英混杂

---

## 八、本轮问题总表（工作流/体验视角）

| 序号 | 类别 | 问题 | 现象 | 影响 | 严重度 |
|---|---|---|---|---|---|
| 1 | 证据采集 | bundle 稳定性不足 | 总入口被慢源/坏源拖垮并 SIGTERM | 影响整个 workflow 启动稳定性 | 高 |
| 2 | 证据采集 | modular fallback 未正式化 | controller 只能临场切分模块补救 | 可维护性差、行为不一致 | 高 |
| 3 | 输出契约 | 用户视图与系统工件未分层 | JSON / appendix / report 混在一起 | 人类体验差 | 高 |
| 4 | 模板语言 | 展示模板半英文半中文 | 标题和字段中英混杂 | 不自然、不专业 | 中-高 |
| 5 | 合规理解 | mandatory artifact 易被误解为必须直出 | 最终回复出现大段 JSON | 严重损害可读性 | 高 |
| 6 | payload 组装 | controller 手工拼 payload 成本高 | 证据 slice 和 warnings 要人工裁剪 | 易错、难稳定复用 | 中 |
| 7 | 体验收口 | 缺少最后一层人类可读性检查 | 输出偏“验收包”而非“最终产品” | 用户体验差 | 高 |

---

## 九、最终结论（面向技能修复）

这次再升科技测试，最有价值的结论不是股票判断，而是下面这几条：

1. **当前 `invest-analysis-pro` 的最大风险点，已经不只是数据源问题，还包括 workflow 默认入口和输出契约设计问题。**
2. **`bundle` 不应继续被默认为唯一主入口，必须正式支持 modular fallback。**
3. **最终输出必须拆分“用户可见报告”和“内部结构化工件”，否则合规越严格，体验越差。**
4. **模板的中英混合骨架确实会误导执行器产出不自然的最终文本。**
5. **这类问题已经足够明确，值得优先修改 `SKILL.md / report-standard.md / final-report-template.md`，而不是仅靠 controller 临场修辞补救。**

---

## 十、建议后续直接落地的改动顺序

1. **先修 `report-standard.md`**：明确区分 user-facing output 与 workflow artifacts
2. **再修 `final-report-template.md`**：展示层全中文化
3. **再修 `SKILL.md / dag-workflow.md`**：把 modular fallback 正式化
4. **最后补 checklist / compliance gate**：增加“用户体验检查项”

这样改，收益最大，也最直接。
