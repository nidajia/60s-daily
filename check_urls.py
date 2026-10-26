#!/usr/bin/env python3
"""自查日报图/接口在当前网络下哪个地址能通、多快。

用法：双击同目录的 check.bat，或命令行 `python check_urls.py`
不看代理，直接按直连测（和微信插件走同样的网络）。
"""
import socket
import ssl
import sys
import time
import urllib.request

REPO = "nidajia/60s-daily"
RAW = "https://raw.githubusercontent.com/" + REPO + "/main"

# 最后一项 True 表示「有长缓存，可能不是今天的图」，不参与最优推荐
TARGETS = [
    ("图片", "gh-proxy", "https://gh-proxy.com/" + RAW + "/60s.png", False),
    ("图片", "ghfast", "https://ghfast.top/" + RAW + "/60s.png", False),
    ("图片", "jsdelivr", "https://gcore.jsdelivr.net/gh/" + REPO + "@main/60s.png", True),
    ("图片", "Pages", "https://nidajia.github.io/60s-daily/60s.png", False),
    ("图片", "raw", RAW + "/60s.png", False),
    ("接口", "gh-proxy", "https://gh-proxy.com/" + RAW + "/api.json", False),
    ("接口", "Pages", "https://nidajia.github.io/60s-daily/api.json", False),
    ("网页", "Pages", "https://nidajia.github.io/60s-daily/", False),
]

URL_OF = dict(((kind, name), url) for kind, name, url, _ in TARGETS)
STALE = dict(((kind, name), s) for kind, name, _, s in TARGETS)

TIMEOUT = 40  # 1.6MB 的图在慢线路上要几十秒，给足
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"


def probe(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    # 强制直连：ignore 系统代理，模拟"没开代理"的真实情况
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    t0 = time.time()
    try:
        with opener.open(req, timeout=TIMEOUT) as r:
            data = r.read()
            dt = time.time() - t0
            return r.status, len(data), dt, None
    except urllib.error.HTTPError as e:
        return e.code, 0, time.time() - t0, "HTTP %s" % e.code
    except (socket.timeout, TimeoutError):
        return 0, 0, time.time() - t0, "超时 %ss" % TIMEOUT
    except Exception as e:
        return 0, 0, time.time() - t0, type(e).__name__


def verdict(kind, size, sec, err, stale):
    if err:
        return "❌ 用不了"
    if kind == "图片":
        if size < 200_000:
            return "⚠️ 内容不全"
        if stale:
            return "🟡 能下(旧图)"
        if sec <= 8:
            return "✅ 可用"
        if sec <= 20:
            return "🟡 偏慢但能用"
        return "🟡 太慢，别用"
    if sec <= 4:
        return "✅ 可用"
    return "🟡 偏慢"


def main():
    print("正在按【直连】方式测试（不走系统代理），最长等 %s 秒…\n" % TIMEOUT)
    head = "%-4s %-10s %-6s %-9s %-11s %s" % ("类型", "地址", "状态", "耗时", "大小", "结论")
    print(head)
    print("-" * 66)
    rows = []
    for kind, name, url, stale in TARGETS:
        st, size, sec, err = probe(url)
        v = verdict(kind, size, sec, err, stale)
        rows.append((kind, name, st, sec, size, v, err, stale))
        size_s = ("%.2fMB" % (size / 1048576)) if size > 100_000 else ("%dB" % size if size else "-")
        print("%-4s %-10s %-6s %-9s %-11s %s" % (
            kind, name, st or "—", "%.2fs" % sec, size_s, v))

    print("-" * 66)
    # 只在「完整下载且没有长缓存」的地址里挑最快的
    ok_img = [r for r in rows
              if r[0] == "图片" and r[5].startswith("✅") and not r[7]]
    if ok_img:
        best = min(ok_img, key=lambda r: r[3])
        print("✅ 建议图片地址：%s（%.2fs）" % (best[1], best[3]))
        print("   %s" % URL_OF[(best[0], best[1])])
        if any(r[0] == "图片" and r[7] and r[5].startswith("🟡") for r in rows):
            print("   注：jsdelivr 虽然常最快，但有 12 小时缓存，可能发的是昨天的图，不建议做主地址。")
    else:
        print("⚠️ 没有图片地址能完整下载，可能本机网络异常或被限流，过几分钟再试。")
    print("\n接口地址用 gh-proxy 或 Pages 都行（小文件，两者都很快）。")
    print("完整说明见 README.md 的「填给微信插件」一节。")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    sys.exit(0)
