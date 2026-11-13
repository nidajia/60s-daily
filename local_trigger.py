#!/usr/bin/env python3
"""本地兜底触发器：每天早上检查日报是否已生成，没生成就立刻让 GitHub Actions 补一次。

为什么需要它：
  GitHub 的 schedule(cron) 只是「尽力而为」。本仓库实测出现过两种故障——
  ① 延迟 4~7 小时才执行；② 六个点位全部被静默丢弃、队列里连记录都没有。
  而 workflow_dispatch（接口触发）是即时执行的，不经过定时队列。
  所以把「叫醒」这件事放到本机来做。

用法：
  python local_trigger.py           # 检查，只有没更新才触发
  python local_trigger.py --force   # 强制触发一次
  python local_trigger.py --check   # 只检查并打印状态，不触发

依赖：token.txt（同目录），内容是一行 GitHub token。
"""
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOG = HERE / "trigger.log"
TOKEN_FILE = HERE / "token.txt"

OWNER, REPO = "nidajia", "60s-daily"
WORKFLOW_ID = "396559235"          # 每日60秒日报
CST = timezone(timedelta(hours=8))

# 按顺序尝试，谁先返回用谁。Pages 最快、ghfast 其次。
API_SOURCES = [
    f"https://{OWNER}.github.io/{REPO}/api.json",
    f"https://ghfast.top/https://raw.githubusercontent.com/{OWNER}/{REPO}/main/api.json",
]


def log(msg):
    line = "[%s] %s" % (datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S"), msg)
    print(line)
    try:
        old = []
        if LOG.exists() and LOG.stat().st_size > 200_000:
            old = LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-500:]
        with LOG.open("w" if old else "a", encoding="utf-8") as f:
            if old:
                f.write("\n".join(old) + "\n")
            f.write(line + "\n")
    except Exception:
        pass  # 日志失败不影响主流程


def read_token():
    if not TOKEN_FILE.exists():
        log("缺少 token.txt —— 请在 %s 里写一行 GitHub token" % TOKEN_FILE)
        return None
    tok = TOKEN_FILE.read_text(encoding="utf-8").strip().splitlines()
    tok = tok[0].strip() if tok else ""
    if not tok:
        log("token.txt 是空的")
        return None
    return tok


def fetch_online_state():
    """返回 (date, stale, 来源)；都失败返回 (None, None, None)"""
    for url in API_SOURCES:
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    "Cache-Control": "no-cache",
                })
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(req, timeout=25) as r:
                    d = json.loads(r.read().decode("utf-8"))
                return d.get("date"), d.get("stale"), url.split("/")[2]
            except Exception as e:
                if attempt == 1:
                    log("  读取失败 %s (%s)" % (url.split("/")[2], type(e).__name__))
                else:
                    time.sleep(2)
    return None, None, None


def dispatch(token):
    url = f"https://api.github.com/repos/{OWNER}/{REPO}/actions/workflows/{WORKFLOW_ID}/dispatches"
    body = json.dumps({"ref": "main"}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "60s-local-trigger")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status in (201, 204), "HTTP %s" % r.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        return False, "HTTP %s %s" % (e.code, detail)
    except Exception as e:
        return False, type(e).__name__


def main():
    force = "--force" in sys.argv
    check_only = "--check" in sys.argv
    today = datetime.now(CST).strftime("%Y-%m-%d")
    log("=" * 52)
    log("开始检查（北京今天 = %s）" % today)

    date, stale, src = fetch_online_state()
    if date is None:
        log("拿不到线上状态，网络可能不通；为避免重复触发，本次不动作")
        return 1

    log("线上状态：date=%s stale=%s（来源 %s）" % (date, stale, src))

    if not force and date == today and stale is False:
        log("✅ 今天的图已经生成，无需处理")
        return 0

    reason = "强制触发" if force else ("线上是 %s" % date if date != today else "线上 stale=true，源站可能还没更新")
    if check_only:
        log("需要更新（%s），但当前是 --check 模式，不触发" % reason)
        return 0

    token = read_token()
    if not token:
        return 1

    log("需要更新（%s）→ 触发 GitHub Actions" % reason)
    ok, info = dispatch(token)
    if ok:
        log("✅ 触发成功（%s），约 5 分钟后出图" % info)
        return 0
    log("❌ 触发失败：%s" % info)
    if "401" in info or "403" in info:
        log("   token 可能失效或权限不足，去 GitHub 重新生成一个")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log("异常：%r" % (e,))
        sys.exit(1)
