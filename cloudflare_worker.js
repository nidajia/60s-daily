// 云端定时触发器（Cloudflare Worker）
// 作用：每天定时调用 GitHub 的"立即执行"接口，让日报 workflow 跑起来。
//       GitHub 自带的 schedule 不可靠（会延迟 4~7 小时，甚至直接丢弃），
//       而 workflow_dispatch 是即时执行的。
//
// 部署步骤见 CLOUD_CRON.md 的「备选方案：Cloudflare Worker」。
//
// 需要的环境变量（Settings → Variables and Secrets）：
//   GH_TOKEN        必填，类型选 Secret。fine-grained PAT，仅需 Actions: Read and write
//   GH_REPO         必填，Text。例如 nidajia/60s-daily
//   GH_WORKFLOW_ID  必填，Text。例如 396559235
//   WINDOW_START    可选，Text，默认 530（北京时间 05:30）
//   WINDOW_END      可选，Text，默认 1100（北京时间 11:00）

// 北京时间 HHMM，用数字表示（05:05 → 505，避免前导零麻烦）
function cnHM() {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  return t.getUTCHours() * 100 + t.getUTCMinutes();
}

function cnDate() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

async function trigger(env) {
  if (!env.GH_TOKEN || !env.GH_REPO) {
    return { status: 500, body: '缺少 GH_TOKEN 或 GH_REPO 环境变量' };
  }
  const wf = env.GH_WORKFLOW_ID || 'daily.yml';
  const res = await fetch(
    `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${wf}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': '60s-daily-worker',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  const text = await res.text();
  return { status: res.status, body: text || '(空响应，204 就代表成功)' };
}

export default {
  // Cron 触发：全天每 10 分钟进来一次，由时间窗决定要不要真的去点
  async scheduled(event, env, ctx) {
    const hm = cnHM();
    const start = parseInt(env.WINDOW_START || '530', 10);
    const end = parseInt(env.WINDOW_END || '1100', 10);
    if (hm < start || hm > end) {
      console.log(`[${cnDate()} ${hm}] 不在生成窗口 ${start}~${end}，跳过`);
      return;
    }
    const r = await trigger(env);
    console.log(`[${cnDate()} ${hm}] dispatch -> HTTP ${r.status} ${r.body}`);
  },

  // 用浏览器打开 Worker 地址即可手动测一次
  async fetch(request, env) {
    const r = await trigger(env);
    return new Response(
      `北京时间: ${cnDate()} ${cnHM()}\nHTTP 状态: ${r.status}\n响应: ${r.body}\n`,
      { headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  },
};
