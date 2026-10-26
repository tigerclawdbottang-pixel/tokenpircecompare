# 模型价格比较平台

对比 **OpenRouter / Fireworks / Wokey / CheaperInference** 四个源的 LLM 价格，单位统一为 **USD / 百万 tokens**。

## 快速开始

**只想看结果**：打开 `web/index.html`（自包含单文件，双击即可，无需联网、无需服务器）。

**想自己采集最新价**（需要 Python 3.9+，零第三方依赖）：

```bash
bash scripts/run_daily.sh
```

首次运行会创建 `data/prices.db` 与当日快照，并重新生成 `web/index.html`。

如需每天自动跑，在本机加一条 cron（脚本已不依赖任何绝对路径）：

```bash
0 9 * * * bash /path/to/modelprice/scripts/run_daily.sh
```

## 三个 Agent

| Agent | 职责 | 入口 |
|---|---|---|
| **A 采集** | 抓四源全量模型价格 → SQLite + 每日快照 | `scripts/collect.py` |
| **A2 官网价** | 抓各厂商官方定价页 → `official_auto.json` | `scripts/fetch_official.py` |
| **B 发布** | 生成比较页面（列表/图表/走势/上传比对） | `scripts/build_site.py` |
| **C 核对** | 日环比异动、发布价一致性、官网价自洽性校验 | `scripts/verify.py` |

日常由 cron 驱动：09:00 跑 A + A2 + B，09:40 跑 C 复核（见上方 cron 示例）。

## 采集细节

| 源 | 数据入口 | 特点 |
|---|---|---|
| OpenRouter | `openrouter.ai/api/v1/models` | 官方 API，字段名以它为准 |
| Fireworks | `app.fireworks.ai/api/models` | 含缓存读价格 |
| Wokey | 页面内嵌 JSON (`wokey-models-page-data`) | 含官方参考价与折扣率 |
| CheaperInference | Next.js flight payload | 含官方原价、折后价、折扣百分比 |

采集到的字段：`input` `output` `cache_read`(命中缓存) `cache_write`(缓存创建) `list_input/output`(官方原价) `discount`(折扣%)。
每个模型的**每个版本**都单独保留（展开行内「版本明细」可看）。

### 跨源匹配

各源命名不一致（`claude-fable-5-1` / `claude-fable-5.1`、`minimax-m3p1-flash` / `minimax-m3.1-flash`），
统一用模糊键匹配：数字间的 `p` 视为小数点，再抹掉所有分隔符。
已排除 `:batch` / `:free` 等非标准计费变体，避免污染最低价。

### 模型官网价格（新增列）

页面在「模型」列后新增 **模型官网价格** 列，取值优先级：

1. **厂商官方定价页** —— `data/official_prices.json`（人工维护，带官方 URL 与核对日期）
   + `scripts/fetch_official.py` 自动抓取（DeepSeek / Z.AI-GLM / Moonshot / MiniMax 等）
2. **OpenRouter 发布价兜底** —— 检索不到官网价时回退，单元格标注 `OR` 角标，
   悬停可看到完整说明（输入/输出/缓存命中/来源链接/核对日期）

| 厂商 | 来源 | 采集方式 |
|---|---|---|
| Anthropic Claude | `platform.claude.com/docs/en/about-claude/pricing` | 人工维护（文档页有区域限制） |
| OpenAI GPT | `openai.com/api-priority-processing` | 人工维护（文档页 403） |
| Google Gemini | `ai.google.dev/gemini-api/docs/pricing` | 人工维护 |
| 阿里 Qwen | 百炼控制台 / DashScope 计费文档 | 人工维护（CNY 按 7.1 折算 USD） |
| Moonshot Kimi | `kimi.com/resources/kimi-k3-1-pro-pricing` | 人工维护（定价页为 SPA） |
| DeepSeek | `api-docs.deepseek.com/quick_start/pricing` | **自动抓取** |
| Z.AI GLM | `docs.z.ai/guides/overview/pricing` | **自动抓取** |
| MiniMax | `platform.minimaxi.com/document/price` | **自动抓取**（CNY 折算） |

官网价是**基准参考**，不参与四源之间的最高（红）/最低（绿）着色。
`data/official_prices.json` 中每条记录带 `checked` 日期，超过 30 天未核对时 Agent C 会告警。

## 页面功能

1. **总览对比** — 选指标（输入/输出/缓存命中/缓存写入/折扣），最低价绿色、最高价红色；点行展开全指标与全部版本。
2. **单独选模型** — 点击任意行即锁定该模型，下方柱状图与汇总卡片同步切换。
3. **柱状图** — 四源价格对比（自绘 SVG，零依赖）。
4. **关注模型** — 国际：Claude / Gemini / GPT 全系列；国产：DeepSeek、Kimi、GLM、Qwen、MiniMax。
5. **价格走势** — 选源 + 选模型，看历史价格曲线（需累积 ≥2 天快照）。
6. **上传比对** — 拖入 `.xlsx/.xlsm/.docx/.csv`，**无需固定格式**，自动识别模型名与价格列；
   高于本站最低价的单元格以**黄色高亮**标出，并给出「你的报价 vs 本站最低/最高」比较曲线。
   也可直接粘贴表格文本兜底。
7. **导出 CSV** — 当前筛选结果。

## 目录

```
modelprice/
├── web/
│   ├── index.html      ← 成品页面（自包含，双击打开）
│   ├── data.json       ← 前端数据
│   ├── template.html / style.css / app.js / parsers.js  ← 源码
├── data/prices.db      ← SQLite 主库（prices / runs / alerts）
├── snapshots/<日期>/   ← 每日原始快照
├── reports/            ← Agent C 每日复核报告
└── scripts/
    ├── collect.py      Agent A
    ├── build_site.py   Agent B
    ├── verify.py       Agent C
    ├── run_daily.sh    每日流水线
    └── smoke.js / test_parsers.js   测试
```

## 测试

测试用到 jsdom（页面 DOM 冒烟），先安装：

```bash
npm install jsdom
export NODE_PATH="$(pwd)/node_modules"
```

然后：

```bash
# 官网价格列专项测试（表头/单元格/来源区分/排序/详情页）
node scripts/test_official_col.js

# 页面 DOM 冒烟
node scripts/smoke.js

# 文件解析 + 智能识别（xlsx / docx / csv）
node scripts/test_parsers.js
```

## 已知限制

- **历史走势**需要每日快照累积，首日只有 1 个数据点，曲线从第 2 天起才有意义。
- OpenRouter / Fireworks 不提供"官方原价"，其 `discount` 为空，折扣列仅 Wokey 与 CheaperInference 有值。
- 价格随上游变动，下单前请以官网为准。
