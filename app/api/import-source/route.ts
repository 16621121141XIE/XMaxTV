import { NextResponse } from 'next/server';

/**
 * 智能添加源：用户粘贴一个网址，服务端抓取内容并自动识别视频源类型，
 * 转换成 XMaxTV 支持的格式后返回，由前端按类型添加为点播源（TVBox API）或直播源（M3U/M3U8）。
 */

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

interface DetectResult {
  kind: 'vod' | 'live';
  url: string;
  name: string;
}

function sanitizeUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 从 M3U 首条 #EXTINF 提取频道名，取不到就用域名 */
function guessLiveName(url: string, body: string): string {
  const m = body.match(/#EXTINF[^,\n]*,(.+)/);
  if (m) {
    const name = m[1].trim();
    if (name) return name.slice(0, 60);
  }
  return hostOf(url);
}

function detect(body: string, contentType: string, url: string): DetectResult | null {
  const ct = (contentType || '').toLowerCase();
  const lowerUrl = url.toLowerCase();

  // 1) M3U / M3U8 直播列表（HLS）
  if (body.includes('#EXTM3U') || body.includes('#EXTINF') || lowerUrl.includes('.m3u') || lowerUrl.includes('.m3u8')) {
    return { kind: 'live', url, name: guessLiveName(url, body) };
  }

  // 2) JSON：TVBox 点播 API（含 class / list 等结构）
  const looksJson = ct.includes('json') || /^\s*[\[{]/.test(body);
  if (looksJson) {
    try {
      const j = JSON.parse(body);
      const isVodShape =
        j &&
        typeof j === 'object' &&
        (Array.isArray((j as Record<string, unknown>).class) ||
          Array.isArray((j as Record<string, unknown>).list) ||
          Array.isArray((j as Record<string, unknown>).videos) ||
          'list' in j ||
          'class' in j);
      if (isVodShape) {
        const site = (j as Record<string, unknown>).site as Record<string, unknown> | undefined;
        const name =
          (typeof site?.name === 'string' && site.name) ||
          (typeof (j as Record<string, unknown>).name === 'string' && (j as Record<string, unknown>).name) ||
          hostOf(url);
        return { kind: 'vod', url, name: String(name).slice(0, 60) };
      }
    } catch {
      /* 不是合法 JSON，继续走其他识别 */
    }
  }

  // 3) 其他：无法识别
  return null;
}

/* ---------- 站点首页解析：用户只给一个网址，自动从中找数据源 ---------- */

/** 从 HTML 文本中提取可能的 TVBox 点播 API 链接（页面里常内嵌在 script/a/iframe 等） */
function extractApiFromHtml(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const push = (u: string) => {
    const abs = new URL(u, baseUrl).toString();
    if (found.indexOf(abs) === -1) found.push(abs);
  };

  // 绝对地址：api.php/provide/vod 或 json.php
  const absRe = /https?:\/\/[^"'\s<>]+?\.php\/(?:provide\/vod|provide\/api)[^"'\s<>]*/gi;
  let m = absRe.exec(html);
  while (m && found.length < 5) {
    const u = m[0].replace(/[)\]},;]+$/, '');
    try { push(u); } catch { /* 忽略非法 */ }
    m = absRe.exec(html);
  }
  const jsonRe = /https?:\/\/[^"'\s<>]+?json\.php[^"'\s<>]*/gi;
  m = jsonRe.exec(html);
  while (m && found.length < 5) {
    const u = m[0].replace(/[)\]},;]+$/, '');
    try { push(u); } catch { /* 忽略非法 */ }
    m = jsonRe.exec(html);
  }

  // 相对地址：'api.php/provide/vod...' 或 "api.php/provide/vod..."
  const relRe = /["']([^"']*?(?:api\.php\/provide\/vod|api\.php\/provide\/api)[^"']*?)["']/gi;
  m = relRe.exec(html);
  while (m && found.length < 5) {
    const p = m[1].replace(/[)\]},;]+$/, '');
    if (/^https?:/i.test(p)) {
      try { push(p); } catch { /* 忽略非法 */ }
    } else if (p.startsWith('//')) {
      try { push('https:' + p); } catch { /* 忽略非法 */ }
    } else if (p.startsWith('/')) {
      try { push(new URL(p, baseUrl).toString()); } catch { /* 忽略非法 */ }
    }
    m = relRe.exec(html);
  }
  return found;
}

/** 对站点试探常见 TVBox API 路径，命中返回可用的接口地址 */
async function probeCommonApis(baseUrl: string): Promise<string | null> {
  const paths = ['/api.php/provide/vod', '/api.php/provide/vod/', '/json.php', '/api.php'];
  for (const p of paths) {
    const target = new URL(p, baseUrl).toString();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(target, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'Mozilla/5.0 (XMaxTV; compatible; source-importer)', accept: 'application/json,*/*' },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.length > MAX_BODY_BYTES) continue;
      try {
        const j = JSON.parse(text);
        const isVodShape =
          j &&
          typeof j === 'object' &&
          (Array.isArray((j as Record<string, unknown>).class) ||
            Array.isArray((j as Record<string, unknown>).list) ||
            'list' in j ||
            'class' in j);
        if (isVodShape) return target;
      } catch {
        /* 不是 JSON，继续试探 */
      }
    } catch {
      /* 网络失败，继续试探 */
    }
  }
  return null;
}

/** 从 HTML 提取站点名（<title>），取不到用域名 */
function siteNameFromHtml(html: string, url: string): string {
  const t = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (t) {
    const s = t[1].trim();
    if (s) return s.slice(0, 40);
  }
  return hostOf(url);
}

export async function POST(req: Request) {
  let payload: { url?: unknown };
  try {
    payload = (await req.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const url = sanitizeUrl(typeof payload.url === 'string' ? payload.url : '');
  if (!url) {
    return NextResponse.json({ error: '请输入有效的 http/https 网址' }, { status: 400 });
  }

  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (XMaxTV; compatible; source-importer)', accept: '*/*' },
    });
    clearTimeout(timer);
  } catch {
    return NextResponse.json({ error: '无法访问该网址（网络错误或超时）' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: `网址返回 HTTP ${res.status}` }, { status: 502 });
  }

  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '该网址返回内容过大，无法识别' }, { status: 413 });
  }

  const d = detect(text, res.headers.get('content-type') || '', url);
  if (d) {
    return NextResponse.json({ kind: d.kind, url: d.url, name: d.name });
  }

  // 站点首页：不是直接的源文件，则尝试解析页面内嵌的数据源或试探常见 API 路径
  const origin = new URL(url).origin;
  const candidates = extractApiFromHtml(text, origin);
  const probed = await probeCommonApis(origin);

  // 从页面提取到的接口优先（更可能是站点真实配置）；其次为试探命中
  let apiUrl: string | null = null;
  for (const c of candidates) {
    if (c.includes('provide/vod') || c.includes('json.php')) {
      apiUrl = c;
      break;
    }
  }
  if (!apiUrl) apiUrl = probed;

  if (apiUrl) {
    return NextResponse.json({
      kind: 'vod',
      url: apiUrl,
      name: siteNameFromHtml(text, url),
      sourceUrl: url,
    });
  }

  return NextResponse.json(
    { error: '未能识别该网址的视频源（支持：M3U/M3U8 直播列表、TVBox 点播 JSON API、站点首页自动解析）' },
    { status: 422 }
  );
}
