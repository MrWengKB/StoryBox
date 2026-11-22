// 可选：Cloudflare Workers 上的极简 CORS 代理，只允许访问 Google Drive 相关域名。
// 部署后在 setup.html 的“CORS 代理”中填写： https://<你的worker>.workers.dev/?url=
const ALLOWED = ['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'];

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const target = new URL(request.url).searchParams.get('url');
    let url;
    try {
      url = new URL(target);
    } catch {
      return new Response('missing ?url=', { status: 400, headers: cors });
    }
    if (url.protocol !== 'https:' || !ALLOWED.includes(url.hostname)) {
      return new Response('host not allowed', { status: 403, headers: cors });
    }
    const res = await fetch(url.toString(), { redirect: 'follow' });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
