# 每日 60 秒日报 · 图片接口

把 <https://60s.timeand.cn/> 每天的日报自动截成图片，并提供一个返回 JSON 的固定接口，供微信插件每天取图发群。

## 原理

原站的「保存图片」是浏览器里用 html2canvas 现画的，服务器上并没有这个 PNG 文件，所以它不可能提供图片 API。
这个方案用无头浏览器替你「点一次保存图片」，把图存进 GitHub 仓库，链接就固定不动了。

每天自动跑两次（北京 07:30、08:30），生成：

- `60s.png` —— 当天日报长图
- `api.json` —— 返回图片地址和新闻文字的接口

## 内容改造：热搜换成财经和 AI

原站 `#lylme main` 下共 5 个板块：60秒新闻 / 实时热搜 / 历史上的今天 / 今日黄历 / 每日一语。

`shot.js` 在截图前用 JS 把「实时热搜」整块删掉，然后克隆第一个板块当样式模板，插入七个新板块，所以字体、缩进、编号跟原站完全一致：

| 板块 | 数据源 | 条数 | 说明 |
| --- | --- | --- | --- |
| 「财经 · 股市」 | 华尔街见闻 A股频道快讯 API | 8 | 盘中异动、融资、大宗 |
| 「币圈 · 加密」 | The Block + Cointelegraph + Decrypt | 8~9 | 首行是 BTC/ETH 行情，其余**自动译成中文** |
| 「AI · 科技」 | IT之家 RSS | 8 | 芯片/半导体/机器人/算力，按关键词筛 |
| 「AI 圈大事」 | 量子位 RSS + 爱范儿 RSS | 9 | 国内 AI 行业与产品动态，中文原生 |
| 「海外 AI 动态」 | TechCrunch AI + The Verge AI | 8 | 国际模型与产品，**自动译成中文** |
| 「国际军事 · 地缘」 | Google News 聚合的**路透社 / 彭博社** + 防务新闻 + 战区 | 8 | 每条前缀标出消息来源，**自动译成中文** |
| 「本周热门开源项目」 | GitHub 搜索 API（近 7 天新建、按星标排序） | 10 | 带【分类】标签和 ★星标数，可直接挑来试，**描述自动译成中文** |

改完图片高度约 7800px。

想调整的话改 `shot.js` 顶部常量：

```js
const FIN_LIMIT    = 8;   // 财经
const CRYPTO_LIMIT = 8;   // 币圈（行情行额外占 1 条，故最多 9 条）
const MIL_LIMIT    = 8;   // 国际军事 / 地缘
const TECH_ITHOME  = 8;   // AI·科技（IT之家）
const TECH_QBT     = 6;   // AI 圈大事（量子位）
const TECH_IFANR   = 3;   // AI 圈大事（爱范儿补充）
const GLOBAL_LIMIT = 8;   // 海外 AI 动态
const GH_LIMIT     = 10;  // 本周热门开源项目
```

### 「国际军事 · 地缘」为什么不是直接抓路透

路透社和彭博社早已停止对外提供 RSS，官网也挡爬虫。所以这条线走 **Google News 的站内检索**：

```
https://news.google.com/rss/search?q=when:3d (site:reuters.com OR site:bloomberg.com) (military OR missile …)
```

Google News 的条目带 `<source>` 字段，正好标明原始媒体，脚本据此打出【路透社】【彭博社】前缀。

Google News 在国内不通（本机 18 秒超时），但**在 GitHub Actions 的美国机房可用**。真不通时会自动退到防务新闻（Defense News）和战区（The War Zone），板块不会空。

### 「币圈 · 加密」的三个细节

1. 首行行情依次尝试 Binance → OKX → Coinbase，三家全不通就**跳过这一行**而不是显示报错。
2. The Block 是专业币圈媒体，Cointelegraph、Decrypt 更杂（Decrypt 会混进 Google 隐私政策、游戏光盘这类新闻），所以用 `CRYPTO_KEY` 按关键词过滤。
3. 两家报道同一件事很常见（比如 Keystone 硬件钱包泄露），靠 `roundRobin()` + `tooSimilar()` 按标题词集相似度去重，同一件事只留一条。


### 「本周热门开源项目」是怎么筛的

用 GitHub 搜索接口取 `created:>7天前` 的仓库，按星标降序，再做四道过滤：

1. `GH_BAD` 剔除 awesome 列表、课程、破解/越狱、漏洞利用 PoC、破限镜像这类仓库；
2. 描述少于 18 字符的丢掉（没有描述的没法判断用途）；
3. `GH_BUCKETS` 按描述关键词打类别标签，**同一类别最多 2 条**——否则某天爆出一个热点，一整屏全是同类项目（比如安卓电视去广告）；
4. 描述先整段翻译、再按中文标点截断，所以在英文上截不会撞坏 `.sql` 这种点号。

Workflow 里把它接到了 `secrets.GITHUB_TOKEN`，搜索接口限速从 10 次/分提到 30 次/分。

几条实现上的坑，改数据源时注意：

- RSS 里 `<channel>` 自己也有 `<title>`，全局正则抓 title 会把频道名混进列表。`rssTitles()` 是按 `<item>` / `<entry>` 逐块取的，别改回去。
- TechCrunch 的标题带 emoji，而 Actions 里只装了 `fonts-noto-cjk`、没有 emoji 字体，emoji 会渲染成方块，所以统一用 `stripEmoji()` 清掉。
- IT之家 是综合科技源，`TECH_KEY` 挑关键词命中，`TECH_SKIP` 剔除售价/刷机这类导购消息。
- 量子位 有会议 PR 稿（前瞻/分论坛/直播），用 `QBT_SKIP` 剔掉。
- 爱范儿 是综合科技媒体，`IFANR_AI` 只留 AI 浓度高的稿子，`IFANR_SKIP` 去掉早报和导购。
- 任何一个源挂掉都不会中断截图，对应板块显示「（今日该板块数据源暂不可用）」。

### 英文条目的自动翻译

四个英文板块（币圈 / 海外 AI / 国际军事 / 开源项目）在出图前会被翻成中文，逻辑在 `translateList()`：

1. 先探测 Google 免费端点（`translate.googleapis.com`）是否可达——通就用它，质量最好；
2. 不通或失败则降到 MyMemory（国内可直连）；
3. 两个都失败就**保留英文原句**，绝不把接口报错文本混进版面；
4. 译完统一走 `tidyZh()`：收敛标点间距、把误音译的 `格罗克` 还原成 `Grok`。

**金额必须特殊处理**：直接把 `$404 million` 交给翻译器，会被拆成「4.04 $」，或和中文单位错位成「损失万美元1600」。所以 `protectMoney()` 在翻译前把金额换成占位符 `ZQX0XQZ`，译完由 `restoreMoney()` 填回「4.04亿美元」。占位符必须用纯字母数字——试过 `⟦0⟧`，被 MyMemory 当成引号翻成了「⟦零⟧」。

判据是「返回文本里必须含汉字」，所以任何源返回限额警告都会被判失败并换下一个源。新增语种或换源时守住这条即可。

机器翻译在满屏产品名的短标题上（比如 `Mercury 3, MiniMax Flash 3.1, Exa 3`）译不出什么，那种条目本就是产品名清单，保留原文反而清楚。

## 部署（3 步）

### 1. 建一个公开仓库

GitHub → New repository → 名称随意（例如 `60s-daily`）→ 选 **Public** → Create。
公开仓库跑 Actions 不消耗额度。

### 2. 创建两个文件

在仓库首页点 **Add file → Create new file**，文件名连路径一起输入，GitHub 会自动建目录。

| 文件名（连路径一起填） | 内容来源 |
| --- | --- |
| `.github/workflows/daily.yml` | 本目录下的 `.github/workflows/daily.yml` |
| `shot.js` | 本目录下的 `shot.js` |

两次都点 **Commit changes**。

### 3. 开跑

- 进仓库的 **Actions** 标签页，若提示 workflow 未启用，点 **I understand my workflows, go ahead and enable them**
- 左侧选「每日60秒日报」→ 右侧 **Run workflow** → 再点绿色的 **Run workflow**
- 等 3~5 分钟，仓库里出现 `60s.png` 和 `api.json` 就成功了

## 填给微信插件

**图片地址（插件里填这个）**：

```
主用：https://gh-proxy.com/https://raw.githubusercontent.com/nidajia/60s-daily/main/60s.png
备用：https://ghfast.top/https://raw.githubusercontent.com/nidajia/60s-daily/main/60s.png
```

**JSON 接口（插件支持读字段时用）**：

```
https://gh-proxy.com/https://raw.githubusercontent.com/nidajia/60s-daily/main/api.json
```

**手机上看图 / 保存图的网页**（GitHub Pages，小文件直连很快）：

```
https://nidajia.github.io/60s-daily/
```

**地址实测（2026-10-26，关掉代理、直接下整张 1.6MB 图）**：

| 地址 | 能否打开 | 下完整张图 | 缓存 | 结论 |
| --- | --- | --- | --- | --- |
| raw.githubusercontent.com | ❌ 12 秒超时 | 下不来 | — | 用不了 |
| nidajia.github.io（Pages） | ✅ 0.5 秒 | 26KB/s，60 秒+ | 10 分钟 | 只能开网页，当图片地址会超时 |
| gh-proxy.com | ✅ | **5.5 秒** | 60 秒 | 图片主地址 |
| ghfast.top | ✅ | 7.1 秒 | 5 分钟 | 备用 |
| gcore.jsdelivr.net | ✅ | 4.0 秒 | 12 小时 | 最快但有长缓存，只做救急 |
| ghproxy.net | ✅ | 40 秒才下 1/3 | — | 太慢，淘汰 |

> 要点：小文件（网页、api.json）走 GitHub Pages 最快；大图（1.6MB）必须走加速镜像，
> 因为 GitHub 的国际出口对国内单连接限速到 26KB/s 左右。

`api.json` 长这样，插件认哪个字段就取哪个（`url` / `image` / `imgurl` / `pic` 都是同一个图片地址）：

```json
{
  "date": "2026-10-26",
  "url": "https://gh-proxy.com/https://raw.githubusercontent.com/.../60s.png",
  "url2": "https://ghfast.top/https://raw.githubusercontent.com/.../60s.png",
  "url3": "https://gcore.jsdelivr.net/gh/.../60s.png",
  "site": "https://nidajia.github.io/60s-daily/",
  "api": "https://gh-proxy.com/https://raw.githubusercontent.com/.../api.json",
  "width": 1400,
  "height": 7782,
  "stale": false,
  "news": ["1、…", "2、…"],
  "finance": ["上海钢联发布数据显示…", "银行股震荡拉升…"],
  "crypto": ["行情：BTC $80,123（-2.4%）· ETH $2,680（+1.1%）", "【The Block】…"],
  "tech": ["英伟达下调 Rubin GPU 系统 HBM 带宽…", "丰田发力人形机器人…"],
  "aiNews": ["实测 Kimi K3.1 Pro，国模终于继续卷旗舰…"],
  "aiGlobal": ["Grok发布其人工智能生成的“奥德赛”的前七分钟…"],
  "military": ["【路透社】…", "【防务新闻】法国、英国首次开展联合空中核打击演习…"],
  "ghTrending": ["【实用工具】pengchujin/aerial-tv ★5.2k — 给国产电视的一块干净桌面…"]
}
```

八个文字数组（`news` / `finance` / `crypto` / `tech` / `aiNews` / `aiGlobal` / `military` / `ghTrending`）跟图里的板块一一对应，方便插件直接拼文字消息，不一定要发图。除 `news` 外都已中文化。

## 注意事项

- **图片别用 raw.githubusercontent.com 和 GitHub Pages 做主链接**：前者国内直连超时，后者能连但只有 26KB/s，1.6MB 的图要 60 秒以上，插件会超时。
- **jsDelivr 的 `@main` 有 12 小时缓存**，会推昨天的图，只能当救急。
- 加速镜像都是免费公共服务，哪天某个慢或挂了，把 `gh-proxy.com` 换成 `ghfast.top` 即可，两个随便切。
- `api.json` 里 `url` / `image` / `imgurl` / `pic` 是主地址，`url2` / `url3` 是备用镜像地址，`site` 是网页版。
- 首次开启 Pages 后要等 1~3 分钟才生效；仓库根目录的 `.nojekyll` 用来关掉 Jekyll 处理。

- Actions 的定时任务在高峰期可能延迟几分钟到半小时，做不到秒级准点。
- 站点每天大约早上 6~7 点更新内容，若某天跑出来是前一天的（`"stale": true`），08:30 那次会自动补正。

## 本地手动跑（可选）

```bash
npm i playwright
npx playwright install chromium
REPO=你的用户名/仓库名 node shot.js
```
