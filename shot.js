// 每天把 60s.timeand.cn 截成一张图，并生成 api.json 供微信插件读取
// 运行环境：GitHub Actions（ubuntu），或本地 Windows
// 可选环境变量：
//   REPO        形如 "用户名/仓库名"，用于生成图片公网地址
//   CHROME_PATH 本地调试时指定 chromium 路径
//   OUT_DIR     输出目录，默认当前目录

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO = process.env.REPO || 'owner/repo';
const OUT_DIR = process.env.OUT_DIR || __dirname;

const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
// 国内直连 raw.githubusercontent.com 不通，统一走加速镜像
// gh-proxy.com 缓存 60 秒、ghfast.top 缓存 5 分钟，都能保证当天出图
const IMG_MAIN = `https://gh-proxy.com/${RAW}/60s.png`;
const IMG_BAK = `https://ghfast.top/${RAW}/60s.png`;
const IMG_CDN = `https://cdn.jsdelivr.net/gh/${REPO}@main/60s.png`;
const API_SELF = `https://gh-proxy.com/${RAW}/api.json`;

function todayCN() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
  });

  const page = await browser.newPage({
    viewport: { width: 800, height: 1400 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  console.log('打开页面…');
  await page.goto('https://60s.timeand.cn/', {
    waitUntil: 'networkidle',
    timeout: 90000,
  });

  await page.waitForSelector('#lylme', { timeout: 30000 });
  await page.waitForTimeout(2500);

  // 隐藏原站自己的按钮（原站截图时也是用 data-html2canvas-ignore 排除的）
  await page.addStyleTag({
    content: '[data-html2canvas-ignore]{display:none !important}',
  });

  // 抓新闻列表文字
  const news = await page.evaluate(() => {
    const uls = [...document.querySelectorAll('#lylme ul')];
    for (const ul of uls) {
      const items = [...ul.querySelectorAll('li')]
        .map((li) => li.innerText.trim())
        .filter(Boolean);
      if (items.length >= 5 && items.some((t) => /^\d+[、.．]/.test(t))) {
        return items.filter((t) => !/未更新/.test(t));
      }
    }
    return [];
  });

  const stale = await page.evaluate(() =>
    /未更新/.test(document.querySelector('#lylme')?.innerText || '')
  );

  const el = await page.$('#lylme');
  if (!el) throw new Error('页面上找不到 #lylme 容器');

  const imgPath = path.join(OUT_DIR, '60s.png');
  await el.screenshot({ path: imgPath });
  const box = await el.boundingBox();

  const api = {
    date: todayCN(),
    updated_at: new Date().toISOString(),
    title: '60秒读懂世界',
    source: 'https://60s.timeand.cn/',
    stale,
    url: IMG_MAIN,
    image: IMG_MAIN,
    imgurl: IMG_MAIN,
    pic: IMG_MAIN,
    url2: IMG_BAK,
    imgurl2: IMG_BAK,
    cdn: IMG_CDN,
    api: API_SELF,
    width: Math.round(box.width * 2),
    height: Math.round(box.height * 2),
    news,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'api.json'),
    JSON.stringify(api, null, 2) + '\n',
    'utf8'
  );

  console.log(`完成：${imgPath}（${news.length} 条新闻，stale=${stale}）`);
  await browser.close();
})().catch((e) => {
  console.error('失败：', e);
  process.exit(1);
});
