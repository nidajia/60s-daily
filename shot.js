// 每天把 60s.timeand.cn 截成一张图，并生成 api.json 供微信插件读取
// 改造点：移除原站「实时热搜」，替换为「财经·股市」和「AI·科技」两个板块
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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FIN_LIMIT = 8;      // 财经条数
const TECH_ITHOME = 8;    // 「AI·科技」：IT之家（半导体/机器人/算力）
const TECH_QBT = 6;       // 「AI 圈大事」：量子位原创报道
const TECH_IFANR = 3;     // 「AI 圈大事」：爱范儿补充
const GLOBAL_LIMIT = 8;   // 海外 AI 动态
const GH_LIMIT = 10;      // 本周热门开源项目

// IT之家 里挑跟半导体 / 机器人 / 算力相关的
const TECH_KEY =
  /(芯片|半导体|晶圆|光刻|GPU|CPU|NPU|算力|机器人|具身|人形|大模型|智能体|人工智能|自动驾驶|激光雷达|HBM|数据中心|服务器|先进封装|存储)/i;
// 排除手机导购 / 刷机这类跟前沿科技无关的
const TECH_SKIP = /(刷入|刷机|售价|预售|国补|开售|优惠|降价|开箱|上手|评测|券后|到手价)/;

// 爱范儿是综合科技媒体，只留 AI 浓度高的稿子
const IFANR_AI =
  /(AI|人工智能|大模型|智能体|Agent|GPT|Claude|Gemini|Kimi|DeepSeek|Qwen|豆包|通义|文心|智谱|机器人|算力|芯片|英伟达|OpenAI|Anthropic)/i;
const IFANR_SKIP = /(早报|晚报|周报|限购|破发|优惠|售价|开售|降价|抽奖)/;

// GitHub 上挑「本周新建的高星项目」，按类别打标签（顺序即匹配优先级）
const GH_BUCKETS = [
  ['3D·空间', /3d|重建|reconstruct|mesh|lidar|场景|room/i],
  ['实用工具', /电视|tv|launcher|tizen|广告|ad[- ]?clean|debloat|推送|cleaner|主屏幕|桌面|home ?screen/i],
  ['模型推理', /模型|推理|inference|llm|参数|训练|token|quantiz|fine-?tun|weights|gpu/i],
  ['Agent', /agent|智能体|claude code|codex|cursor|copilot|mcp|skill/i],
  ['图像·视频', /图像|图片|image|svg|视频|video|动效|motion|voice|语音|音频|audio/i],
  ['开发工具', /代码|code|编程|框架|sdk|api|cli|database|sql|typescript/i],
];
const GH_BAD =
  /(awesome-|curated list|interview|cheat ?sheet|roadmap|tutorial|course|jailbreak|uncensored|nsfw|porn|crack|keygen|resume|wallpaper|onlyfans|casino|purge|破甲|mirror of|镜像仓|exploit|\bpoc\b|cve-\d|rce|bypass|漏洞利用|渗[透透]|免杀|钓鱼)/i;

function todayCN() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function clean(s) {
  return (s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&apos;|&rsquo;|&lsquo;|&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// 去掉 emoji（Actions 里没装 emoji 字体，会渲染成方块）和多余逗号
function stripEmoji(s) {
  return s
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s, n) {
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  // 优先在句读处断开，避免「…以及…」这种半截话
  const m = head.match(/^[\s\S]*[，。、；：,;.!?]/);
  const cut = (m ? m[0] : head).replace(/[，。、；：,;.\s]+$/, '');
  return (cut || head) + '…';
}

async function fetchText(url, referer, timeout = 20000, extra = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        ...(referer ? { Referer: referer } : {}),
        ...extra,
      },
      signal: ctl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 翻译：海外条目统一转中文 ----------
const CJK = /[\u4e00-\u9fa5]/;

// 源 1：Google 免费端点（境外机房快、质量好，国内直连不通）
async function translateGoogle(text) {
  const u =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' +
    encodeURIComponent(text);
  const j = JSON.parse(await fetchText(u, null, 12000));
  return (j?.[0] || []).map((x) => x?.[0] || '').join('');
}

// 源 2：MyMemory（国内可直连，作为兜底）
async function translateMyMemory(text) {
  const u =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=en|zh-CN';
  const j = JSON.parse(await fetchText(u, null, 15000));
  return j?.responseData?.translatedText || '';
}

// 限并发，避免把免费接口打限速
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const idx = i++;
      try {
        out[idx] = await fn(list[idx], idx);
      } catch (e) {
        out[idx] = list[idx];
      }
    }
  });
  await Promise.all(workers);
  return out;
}

// 只探测一次：Google 在部分网络下完全不通，逐条等超时太浪费
let googleProbe = null;
function googleAlive() {
  if (!googleProbe) {
    googleProbe = translateGoogle('hello')
      .then((t) => CJK.test(t || ''))
      .catch(() => false);
  }
  return googleProbe;
}

// 机器翻译常把产品名音译，翻回来保持全篇一致
const TERM_FIX = [
  [/格罗克|格罗克人工智能/g, 'Grok'],
  [/开放人工智能|开放式人工智能/g, 'OpenAI'],
  [/人类学公司|人类学AI/g, 'Anthropic'],
  [/深度求索|深度搜索/g, 'DeepSeek'],
  [/谷歌双子座|双子座模型|双子星模型/g, 'Gemini'],
  [/腾讯通\s*(\d)/g, 'RTX $1'],
  [/腾讯通/g, 'RTX'],
  [/克劳德/g, 'Claude'],
  [/副驾驶/g, 'Copilot'],
  [/拥抱脸/g, 'Hugging Face'],
];

// 译文排版清理：去掉中文标点两侧空格、统一逗号、修掉「$ T」这类金额畸形
function tidyZh(s) {
  let out = s
    .replace(/\$\s*T\b/gi, '万亿美元')
    .replace(/\$\s*B\b/gi, '亿美元')
    .replace(/(\d)\s+(万亿|亿美元)/g, '$1$2')
    .replace(/\s*,\s*/g, '，')
    .replace(/\s*([，。、：；！？（）《》])\s*/g, '$1')
    .replace(/([，。、：；！？])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [re, to] of TERM_FIX) out = out.replace(re, to);
  // 翻译接口常在中文后面拖一段没译完的英文，长度不大就整段剪掉
  out = out.replace(/\s+[A-Za-z][A-Za-z0-9\s\-.'’&,]{5,20}$/, '');
  // 源站标题自带被截断的「......」，统一成单个省略号
  return out.replace(/(?:\.{2,}|…+)\s*$/, '…').trim();
}

// 已经是中文就不翻；两个源都失败就保留英文原句，不影响出图
async function translateList(list, tag) {
  // 探测本身也限一次，失败就直接只用兜底源
  const probe = new Promise((r) => {
    const t = setTimeout(() => r(false), 9000);
    googleAlive().then((v) => {
      clearTimeout(t);
      r(v);
    });
  });
  const useGoogle = await probe;
  const sources = useGoogle
    ? [translateGoogle, translateMyMemory]
    : [translateMyMemory];
  console.log(`${tag}：翻译源 ${useGoogle ? 'Google + MyMemory' : 'MyMemory（Google 不可达）'}`);

  const out = await mapLimit(list, 3, async (s) => {
    if (CJK.test(s)) return s;
    for (const fn of sources) {
      try {
        const t = tidyZh(clean(await fn(s)));
        // 必须真拿到中文，且不能是接口的限额警告
        if (CJK.test(t) && !/MYMEMORY|WARNING|QUOTA|INVALID/i.test(t)) {
          return clip(t, 92);
        }
      } catch (e) {
        /* 换下一个源 */
      }
    }
    return s; // 全失败：保留原文
  });
  const ok = out.filter((x) => CJK.test(x)).length;
  console.log(`${tag}：${ok}/${out.length} 条已转为中文`);
  return out;
}

// 财经 / 股票：华尔街见闻 A股频道实时快讯
async function getFinance(limit) {
  const txt = await fetchText(
    `https://api-one.wallstcn.com/apiv1/content/lives?channel=a-stock-channel&limit=${limit + 6}`,
    'https://wallstreetcn.com/live/a-stock'
  );
  const json = JSON.parse(txt);
  const items = (json?.data?.items || [])
    // 优先用完整正文，标题往往只有半句话，长短不一会显得参差
    // 原文有时自带「1、」序号，去掉，否则会和版面自己的编号叠成「4、1、…」
    .map((it) =>
      clean(it.content_text || it.title || '').replace(/^\d+\s*[、.．:：]\s*/, '')
    )
    .filter((s) => s.length >= 10);
  const out = [];
  for (const s of items) {
    const t = clip(s, 92);
    if (!out.includes(t)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

// 按 <item> / <entry> 逐块取标题，避免把 feed 自己的名字混进列表
function rssTitles(xml) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entries = items.length
    ? items
    : [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  return entries
    .map((block) => {
      const m = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return m ? clean(m[1]) : '';
    })
    .filter(Boolean);
}

// 量子位的会议 PR 稿（前瞻/分论坛/报名）无信息量，跳过
const QBT_SKIP = /(前瞻|分论坛|报名|直播|邀请函|圆满|落幕|峰会预告|招商)/;

// 国内 AI：量子位（专注 AI 的原创报道，用于「AI 圈大事」）
async function getCnAI(limit) {
  const xml = await fetchText('https://www.qbitai.com/feed', 'https://www.qbitai.com/');
  return rssTitles(xml)
    .filter((s) => s.length >= 6 && !QBT_SKIP.test(s))
    .slice(0, limit)
    .map((s) => clip(s, 72));
}

// 爱范儿的 AI 稿件，补量子位没覆盖到的产品实测类内容
async function getIfanrAI(limit) {
  const xml = await fetchText('https://www.ifanr.com/feed', 'https://www.ifanr.com/');
  const titles = rssTitles(xml).filter(
    (s) => s.length >= 8 && IFANR_AI.test(s) && !IFANR_SKIP.test(s)
  );
  return [...new Set(titles)].slice(0, limit).map((s) => clip(s, 72));
}

// 半导体 / 机器人 / 算力：IT之家里按关键词筛
async function getCnTech(limit) {
  const xml = await fetchText('https://www.ithome.com/rss/', 'https://www.ithome.com/');
  const titles = rssTitles(xml).filter(
    (s) => s.length >= 6 && TECH_KEY.test(s) && !TECH_SKIP.test(s)
  );
  return [...new Set(titles)].slice(0, limit).map((s) => clip(s, 72));
}

// 海外 AI：The Verge + TechCrunch
async function getGlobalAI(limit) {
  // TechCrunch 的 AI 频道更聚焦产品与融资，优先用；Verge 收录偏宽，只作兜底
  const srcs = [
    [
      'https://techcrunch.com/category/artificial-intelligence/feed/',
      'https://techcrunch.com/category/artificial-intelligence/',
    ],
    [
      'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
      'https://www.theverge.com/ai-artificial-intelligence',
    ],
  ];
  const results = await Promise.allSettled(srcs.map(([u, ref]) => fetchText(u, ref)));
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...rssTitles(r.value));
  }
  const out = [];
  for (const s of all) {
    if (s.length < 12 || /^AI \| /.test(s)) continue;
    const t = clip(stripEmoji(s), 95);
    if (!out.includes(t)) out.push(t);
    if (out.length >= limit) break;
  }
  return translateList(out, '海外AI');
}

// 本周热门开源项目：GitHub 近 7 天新建的高星仓库，带星标数，方便挑来试
function fmtStar(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
}

async function getGithubTrending(limit) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const headers = { Accept: 'application/vnd.github+json' };
  // Actions 里自带 GITHUB_TOKEN，带上能把限速从 10 次/分提到 30 次/分
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = 'Bearer ' + token;

  const search = (query) =>
    fetchText(
      'https://api.github.com/search/repositories?q=' +
        encodeURIComponent(query) +
        '&sort=stars&order=desc&per_page=40',
      null,
      25000,
      headers
    ).then((t) => JSON.parse(t).items || []);

  // 主查询给高星项目；补一条 AI 话题的，防止某天高星新项目不够
  const batches = await Promise.allSettled([
    search(`created:>${since} stars:>120`),
    search(`created:>${since} topic:llm stars:>40`),
  ]);
  const all = [];
  for (const b of batches) if (b.status === 'fulfilled') all.push(...b.value);

  // 纯按星标排序：这才是「热门」的客观口径
  const scored = all
    .map((r) => {
      const desc = clean(r.description || '');
      const blob = [r.name, desc, ...(r.topics || [])].join(' ');
      return { r, desc, blob };
    })
    .filter(({ desc, blob }) => {
      if (!desc || desc.length < 18) return false;
      if (GH_BAD.test(blob)) return false;
      return true;
    })
    .sort((a, b) => b.r.stargazers_count - a.r.stargazers_count);

  // 同类主题最多 2 条，否则一整屏都是「安卓电视去广告」
  const used = {};
  const seen = new Set();
  const picked = [];
  for (const { r, desc, blob } of scored) {
    if (seen.has(r.full_name)) continue;
    seen.add(r.full_name);
    const tag = (GH_BUCKETS.find(([, re]) => re.test(blob)) || ['其他'])[0];
    used[tag] = (used[tag] || 0) + 1;
    if (used[tag] > 2) continue;
    picked.push({ r, desc, tag });
    if (picked.length >= limit) break;
  }

  // 描述先整段翻译，再按中文标点截断（在英文上截会撞坏 .sql 这类点号）
  const zh = await translateList(
    picked.map(({ desc }) => clip(desc, 110)),
    '本周项目'
  );
  return picked.map(
    ({ r, tag }, i) =>
      `【${tag}】${r.full_name} ★${fmtStar(r.stargazers_count)} — ${clip(zh[i], 62)}`
  );
}

(async () => {
  // ---------- 1. 先取外部资讯，任一失败都不阻断主流程 ----------
  const safe = (name, p) =>
    p.catch((e) => {
      console.log(`${name}失败：` + e.message);
      return [];
    });

  const [finance, techCn, qbt, ifanr, aiGlobal, ghTrending] = await Promise.all([
    safe('财经源', getFinance(FIN_LIMIT)),
    safe('IT之家', getCnTech(TECH_ITHOME)),
    safe('量子位', getCnAI(TECH_QBT)),
    safe('爱范儿', getIfanrAI(TECH_IFANR)),
    safe('海外AI', getGlobalAI(GLOBAL_LIMIT)),
    safe('GitHub', getGithubTrending(GH_LIMIT)),
  ]);

  const tech = [...techCn].filter((s, i, arr) => arr.indexOf(s) === i);
  const aiNews = [...qbt, ...ifanr].filter((s, i, arr) => arr.indexOf(s) === i);
  console.log(
    `外部资讯：财经 ${finance.length} / 科技 ${tech.length} / AI要闻 ${aiNews.length}（量子位 ${qbt.length}+爱范儿 ${ifanr.length}）/ 海外 ${aiGlobal.length} / 开源项目 ${ghTrending.length}`
  );

  // ---------- 2. 打开原站 ----------
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

  // ---------- 3. 把「实时热搜」换成财经 / AI 板块 ----------
  const replaced = await page.evaluate(
    ({ finance, tech, aiNews, aiGlobal, ghTrending }) => {
      const main = document.querySelector('#lylme main');
      if (!main) return 'no-main';

      const blocks = [...main.children].filter((e) => e.tagName === 'DIV');
      const tpl = blocks[0]; // 第一个板块「60秒读懂世界」当样式模板
      if (!tpl) return 'no-template';

      const findBlock = (kw) =>
        blocks.find((b) => ((b.querySelector('h1') || {}).innerText || '').includes(kw));

      const hot = findBlock('实时热搜');
      if (!hot) return 'no-hot';

      const makeBlock = (title, items) => {
        const node = tpl.cloneNode(true);
        const h1 = node.querySelector('h1');
        if (h1) h1.innerHTML = '<i>' + title + '</i>';
        const ul = node.querySelector('ul');
        if (ul) {
          ul.innerHTML = '';
          if (items.length) {
            items.forEach((t, i) => {
              const li = document.createElement('li');
              li.className = 'mt-1 leading-6';
              li.textContent = i + 1 + '、' + t;
              ul.appendChild(li);
            });
          } else {
            const li = document.createElement('li');
            li.className = 'mt-1 leading-6';
            li.textContent = '（今日该板块数据源暂不可用）';
            ul.appendChild(li);
          }
        }
        // 模板里若混入表格等其它节点，一并去掉
        [...node.children].forEach((c) => {
          if (c.tagName !== 'H1' && c.tagName !== 'UL') c.remove();
        });
        return node;
      };

      const panels = [
        ['「财经 · 股市」', finance],
        ['「AI · 科技」', tech],
        ['「AI 圈大事」', aiNews],
        ['「海外 AI 动态」', aiGlobal],
        ['「本周热门开源项目」', ghTrending],
      ];
      for (const [title, items] of panels) {
        hot.parentNode.insertBefore(makeBlock(title, items), hot);
      }
      hot.remove();
      return 'ok';
    },
    { finance, tech, aiNews, aiGlobal, ghTrending }
  );
  console.log('板块替换：' + replaced);

  await page.waitForTimeout(300);

  // ---------- 4. 抓新闻文字 ----------
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

  // ---------- 5. 截图 + 生成 api.json ----------
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
    finance,
    tech,
    aiNews,
    aiGlobal,
    ghTrending,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'api.json'),
    JSON.stringify(api, null, 2) + '\n',
    'utf8'
  );

  console.log(
    `完成：${imgPath}（新闻 ${news.length} / 财经 ${finance.length} / 科技 ${tech.length} / AI要闻 ${aiNews.length} / 海外 ${aiGlobal.length} / 开源项目 ${ghTrending.length}，stale=${stale}）`
  );
  await browser.close();
})().catch((e) => {
  console.error('失败：', e);
  process.exit(1);
});
