# 云端定时：让日报每天准时更新

## 为什么需要这一步

GitHub 自带的定时器（`schedule`）是"尽力而为"的，实测在你这个仓库上：

| 日期 | 我设的 6 个点位（北京 06:40~09:10）实际表现 |
| --- | --- |
| 11-11 | 全部执行，但整体延后到 10:12 ~ 15:42（延迟 3.5~6.5 小时） |
| 11-12 | 全部执行，延后到 11:18 ~ 16:11（延迟 4.5~7 小时） |
| 11-13 | 6 个点位**连排队记录都没有**，被直接丢弃 |

而"立即触发"接口（`workflow_dispatch`）是**即时执行**的：10:02 触发，10:03 就出图。

所以办法是：**找一个云端服务，每天准时帮我们点一下"运行"按钮**。

## 工作原理

```
云端定时器（每 10 分钟）
        ↓  调用 GitHub 的立即执行接口
workflow 先检查：今天生成过没有？
        ├─ 生成过  → 8 秒退出，什么都不做
        └─ 没生成  → 正常跑一遍（约 5 分钟），出图
```

一天只有第一次真正干活，其余全是 8 秒秒退。所以就算频繁触发也不费事。
另外 workflow 里还加了「只在早上 05:30~11:00 才干活」的窗口，凌晨触发会自动跳过。

---

## 第 1 步：建一个"只够触发"的 token（约 2 分钟）

现在那个 `ghp_Ws1Ay...` 权限太大（能改你所有仓库的代码），而且已经在聊天里露过了，不适合放进云端平台。新建一个权限最小的：

1. 打开 <https://github.com/settings/personal-access-tokens/new>
2. **Token name**：填 `60s-daily-cron`
3. **Expiration**：选 `Custom` → 填一个比较远的日期（比如一年后），或者 `No expiration`
4. **Repository access** → 选 **Only select repositories** → 只勾 `60s-daily`
5. **Repository permissions** 往下找，只把 **Actions** 改成 **Read and write**
6. 拉到底点 **Generate token**
7. 复制那一串 `github_pat_...`（**只显示这一次，先粘到记事本**）

> 这个 token 即使泄露，别人最多只能触发你这个仓库的 Actions，读不到代码、改不了东西。

## 第 2 步：注册 cron-job.org 并建任务（约 3 分钟）

1. 打开 <https://console.cron-job.org/signup>
2. 用邮箱注册，去邮箱点验证链接
3. 登录后点 **+ CREATE CRONJOB**
4. **Common** 区域按下表填：

| 字段 | 填什么 |
| --- | --- |
| **Title** | `60s日报` |
| **URL** | `https://api.github.com/repos/nidajia/60s-daily/actions/workflows/396559235/dispatches` |
| **Enable job** | 打开（默认就是开的） |
| **Execution schedule** | 选 **Every 10 minutes** |

5. 切到 **ADVANCED** 标签页，按下表填：

| 字段 | 填什么 |
| --- | --- |
| **Request method** | `POST` |
| **Request body** | `{"ref":"main"}` |
| **Headers** | 下面 4 行，一行一条 |

```
Authorization: Bearer 粘贴你刚才的 github_pat_...
Accept: application/vnd.github+json
Content-Type: application/json
User-Agent: 60s-daily-cron
```

> `User-Agent` 那条**不能省**，GitHub 会直接拒绝没有 UA 的请求。

6. 点 **TEST RUN**（测试运行）
   - 看到 **HTTP 204** = 成功 ✅
   - 看到 **401** = token 填错或没复制完整
   - 看到 **403** = token 权限不对，回第 1 步检查有没有给 Actions: write
   - 看到 **404** = URL 里的仓库名或 workflow 编号填错
7. 点 **CREATE** 保存

## 第 3 步：验证

建好后不用管。第二天早上打开图片地址看日期是不是当天就行。

想立刻验证通路是否打通：在 cron-job.org 的任务列表里点一下 **TEST RUN**，然后去
<https://github.com/nidajia/60s-daily/actions> 看有没有新的运行记录冒出来（秒退也算成功）。

---

## 常见问题

**Q：会不会一天跑很多次，把额度用光？**
不会。仓库是 public，Actions 分钟数本来就免费无限。而且闸门让重复触发只花 8 秒。

**Q：凌晨会生成错误的图吗？**
不会。workflow 里限制了只在北京 05:30~11:00 才干活，窗口外一律跳过。

**Q：cron-job.org 挂了怎么办？**
还有两层兜底：GitHub 自己的 cron（07:00 / 08:00 / 09:00 三个点位）、以及本机 `install_task.bat`。

**Q：免费账户会被停用吗？**
cron-job.org 对长期不登录的免费账户可能停用任务。隔几个月登录看一眼即可。

**Q：想立刻补今天的图怎么做？**
两种方式，任选：
- 网页：<https://github.com/nidajia/60s-daily/actions/workflows/daily.yml> → Run workflow → 勾上 `force` → 运行
- 本地：双击 `run_trigger.bat`（或在命令行跑 `python local_trigger.py --force`）

---

## 备选方案：Cloudflare Worker

如果 cron-job.org 注册不顺利（比如邮箱收不到验证信），可以用 Cloudflare，它的定时器更稳，而且 token 存在 Cloudflare 的加密变量里，不用暴露在请求头配置中。

代码已备好在本目录的 `cloudflare_worker.js`，配置步骤：

1. 注册 <https://dash.cloudflare.com/sign-up>
2. 左侧 **Workers & Pages** → **Create** → **Worker** → 起名 `daily-60s` → **Deploy**
3. 点 **Edit code**，把 `cloudflare_worker.js` 的内容整个粘进去 → **Deploy**
4. 回到 Worker 页面 → **Settings** → **Variables and Secrets** → 添加：
   - `GH_TOKEN`（类型选 **Secret**）= 你的 `github_pat_...`
   - `GH_REPO`（类型选 Text）= `nidajia/60s-daily`
   - `GH_WORKFLOW_ID`（类型选 Text）= `396559235`
5. 同一页 **Trigger Events** → **Cron Triggers** → **Add** → 填 `*/10 * * * *` → 保存
6. 在浏览器打开 `https://daily-60s.你的子域.workers.dev` 测试，返回 `204` 即成功

Worker 内部同样带 05:30~11:00 时间窗判断，凌晨不会乱跑。
