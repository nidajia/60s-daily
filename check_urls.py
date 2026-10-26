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

TARGETS = [
    ("图片", "gh-proxy", "https://gh-proxy.com/" + RAW + "/60s.png"),
    ("图片", "ghfast", "https://ghfast.top/" + RAW + "/60s.png"),
    ("图片", "jsdelivr", "https://gcore.jsdelivr.net/gh/" + REPO + "@main/60s.png"),
    ("图片", "Pages", "https://nidajia.github.io/60s-daily/60s.png"),
    ("图片", "raw", RAW + "/60s.png"),
    ("接口", "gh-proxy", "https://gh-proxy.com/" + RAW + "/api.json"),
    ("接口", "Pages", "https://nidajia.github.io/60s-daily/api.json"),
    ("网页", "Pages", "https://nidajia.github.io/60s-daily/"),
]

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


def verdict(kind, ok, size, sec, err):
    if err:
        return "❌ 用不了"
    if kind == "图片":
        if size < 200_000:
            return "⚠️ 内容不全"
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
    print("-" * 62)
    rows = []
    for kind, name, url in TARGETS:
        st, size, sec, err = probe(url)
        v = verdict(kind, st == 200, size, sec, err)
        rows.append((kind, name, st, sec, size, v, err))
        size_s = ("%.2fMB" % (size / 1048576)) if size > 100_000 else ("%dB" % size if size else "-")
        print("%-4s %-10s %-6s %-9s %-11s %s" % (
            kind, name, st or "—", "%.2fs" % sec, size_s, v))

    print("-" * 62)
    ok_img = [r for r in rows if r[0] == "图片" and r[5].startswith(("✅", "🟡 偏慢但能用"))]
    if ok_img:
        best = min(ok_img, key=lambda r: r[3])
        print("建议图片地址用：%s（%.2fs）" % (best[1], best[3]))
        print("   %s" % dict((n, u) for _, n, u in TARGETS)[best[1]])
    else:
        print("⚠️ 没有图片地址能完整下载，可能是本机网络异常，或被限流，稍后再试。")
    print("\n完整地址清单见 README.md 的「填给微信插件」一节。")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    sys.exit(0)
