# 每日 60 秒日报 · 图片接口

把 <https://60s.timeand.cn/> 每天的日报自动截成图片，并提供一个返回 JSON 的固定接口，供微信插件每天取图发群。

## 原理

原站的「保存图片」是浏览器里用 html2canvas 现画的，服务器上并没有这个 PNG 文件，所以它不可能提供图片 API。
这个方案用无头浏览器替你「点一次保存图片」，把图存进 GitHub 仓库，链接就固定不动了。

每天自动跑两次（北京 07:30、08:30），生成：

- `60s.png` —— 当天日报长图
- `api.json` —— 返回图片地址和新闻文字的接口

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

把下面两个地址里的 `你的用户名` `仓库名` 换成实际值：

```
接口（推荐）：https://raw.githubusercontent.com/你的用户名/仓库名/main/api.json
备用（国内常更快）：https://cdn.jsdelivr.net/gh/你的用户名/仓库名@main/api.json
```

`api.json` 长这样，插件认哪个字段就取哪个（`url` / `image` / `imgurl` / `pic` 都是同一个图片地址）：

```json
{
  "date": "2026-10-26",
  "url": "https://raw.githubusercontent.com/.../60s.png",
  "width": 1400,
  "height": 8366,
  "stale": false,
  "news": ["1、…", "2、…"]
}
```

## 注意事项

- **jsDelivr 有约 12 小时缓存**，当天新图可能延迟出现；要即时更新用 raw 那个地址。
- **raw.githubusercontent.com 在国内可能直连不通**，如果插件取不到，把地址前缀换成加速镜像，例如：
  - `https://ghfast.top/https://raw.githubusercontent.com/你的用户名/仓库名/main/api.json`
  - `https://gh-proxy.com/https://raw.githubusercontent.com/你的用户名/仓库名/main/api.json`
- Actions 的定时任务在高峰期可能延迟几分钟到半小时，做不到秒级准点。
- 站点每天大约早上 6~7 点更新内容，若某天跑出来是前一天的（`"stale": true`），08:30 那次会自动补正。

## 本地手动跑（可选）

```bash
npm i playwright
npx playwright install chromium
REPO=你的用户名/仓库名 node shot.js
```
