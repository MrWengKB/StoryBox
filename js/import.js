// Google Drive 链接解析、文件夹抓取、PDF 下载与 pdf.js 加载

import { getSettings, cache } from './store.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const PDF_MIME = 'application/pdf';

/* ---------- 链接解析 ---------- */
// 返回 { kind: 'file'|'folder'|'unknown', id, resourceKey } 或 { kind: 'url', url } 或 null
export function parseDriveUrl(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^[\w-]{20,}$/.test(s)) return { kind: 'unknown', id: s, resourceKey: '' };
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const rk = u.searchParams.get('resourcekey') || '';
  const host = u.hostname;
  if (/(^|\.)google\.com$/.test(host) || /(^|\.)googleusercontent\.com$/.test(host)) {
    let m = u.pathname.match(/\/folders\/([\w-]+)/);
    if (m) return { kind: 'folder', id: m[1], resourceKey: rk };
    if (/folderview/.test(u.pathname) && u.searchParams.get('id'))
      return { kind: 'folder', id: u.searchParams.get('id'), resourceKey: rk };
    m = u.pathname.match(/\/(?:file\/)?d\/([\w-]+)/);
    if (m) return { kind: 'file', id: m[1], resourceKey: rk };
    const id = u.searchParams.get('id');
    if (id) return { kind: 'unknown', id, resourceKey: rk };
  }
  if (/^https?:$/.test(u.protocol)) return { kind: 'url', url: u.href };
  return null;
}

/* ---------- 网络工具 ---------- */
export function withProxy(url, proxy) {
  if (!proxy) return url;
  return proxy.includes('{url}')
    ? proxy.replace('{url}', encodeURIComponent(url))
    : proxy + encodeURIComponent(url);
}

function rkHeaders(id, rk) {
  return rk ? { 'X-Goog-Drive-Resource-Keys': `${id}/${rk}` } : {};
}

async function apiError(res) {
  let msg = '';
  try {
    msg = (await res.json())?.error?.message || '';
  } catch {}
  if (res.status === 404) return new Error('找不到文件：请确认链接正确，并已设置为“知道链接的任何人都可查看”。');
  if (res.status === 403)
    return new Error('没有访问权限（403）：请确认文件已公开分享，且 API Key 已启用 Google Drive API、来源限制包含本网站。' + (msg ? `\n${msg}` : ''));
  if (res.status === 400) return new Error('请求无效（400）：API Key 可能填写错误。' + (msg ? `\n${msg}` : ''));
  return new Error(`请求失败（${res.status}）${msg ? '：' + msg : ''}`);
}

function needAccess() {
  return new Error('浏览器无法直接读取 Google Drive 的文件（跨域限制）。请先在“设置”页填写 Google Drive API Key（或 CORS 代理）。');
}

/* ---------- 元数据 ---------- */
export async function getFileMeta(id, rk) {
  const { apiKey } = getSettings();
  if (!apiKey) return null;
  const url = `${API}/${encodeURIComponent(id)}?fields=id,name,mimeType,resourceKey,shortcutDetails&supportsAllDrives=true&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: rkHeaders(id, rk) });
  if (!res.ok) throw await apiError(res);
  return res.json();
}

/* ---------- 文件夹抓取 ---------- */
// 返回 [{ id, name, resourceKey }]，只含 PDF
export async function listFolder(id, rk, { recursive = true, onProgress } = {}) {
  const { apiKey, proxy } = getSettings();
  if (apiKey) return listFolderApi(id, rk, apiKey, recursive, onProgress, '', 0);
  if (proxy) return listFolderProxy(id, rk, proxy, recursive, onProgress, '', 0);
  throw needAccess();
}

const MAX_DEPTH = 4;

async function listFolderApi(id, rk, key, recursive, onProgress, prefix, depth) {
  const out = [];
  const subfolders = [];
  let pageToken = '';
  do {
    const q = `'${id}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken,files(id,name,mimeType,resourceKey,shortcutDetails)',
      pageSize: '1000',
      orderBy: 'folder,name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      key,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`${API}?${params}`, { headers: rkHeaders(id, rk) });
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    for (const f of data.files || []) {
      let mime = f.mimeType;
      let fid = f.id;
      if (mime === SHORTCUT_MIME && f.shortcutDetails) {
        mime = f.shortcutDetails.targetMimeType;
        fid = f.shortcutDetails.targetId;
      }
      if (mime === PDF_MIME || (/\.pdf$/i.test(f.name) && mime !== FOLDER_MIME)) {
        out.push({ id: fid, name: prefix + stripPdf(f.name), resourceKey: f.resourceKey || '' });
      } else if (mime === FOLDER_MIME) {
        subfolders.push({ id: fid, name: f.name, resourceKey: f.resourceKey || '' });
      }
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  onProgress && onProgress(out.length, prefix);
  if (recursive && depth < MAX_DEPTH) {
    for (const sf of subfolders) {
      out.push(...(await listFolderApi(sf.id, sf.resourceKey, key, recursive, onProgress, `${prefix}${sf.name} / `, depth + 1)));
    }
  }
  return out;
}

// 无 API Key 时：通过代理读取 Drive 的“嵌入式文件夹视图”页面并解析
async function listFolderProxy(id, rk, proxy, recursive, onProgress, prefix, depth) {
  let url = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`;
  if (rk) url += `&resourcekey=${encodeURIComponent(rk)}`;
  const res = await fetch(withProxy(url, proxy));
  if (!res.ok) throw new Error(`代理读取文件夹失败（${res.status}）`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const out = [];
  const subfolders = [];
  for (const entry of doc.querySelectorAll('.flip-entry')) {
    const eid = (entry.id || '').replace(/^entry-/, '');
    const name = entry.querySelector('.flip-entry-title')?.textContent?.trim() || eid;
    const href = entry.querySelector('a')?.getAttribute('href') || '';
    if (!eid) continue;
    if (/\/folders\//.test(href)) subfolders.push({ id: eid, name });
    else if (/\.pdf$/i.test(name)) out.push({ id: eid, name: prefix + stripPdf(name), resourceKey: '' });
  }
  onProgress && onProgress(out.length, prefix);
  if (recursive && depth < MAX_DEPTH) {
    for (const sf of subfolders) {
      out.push(...(await listFolderProxy(sf.id, '', proxy, recursive, onProgress, `${prefix}${sf.name} / `, depth + 1)));
    }
  }
  return out;
}

export function stripPdf(name) {
  return (name || '').replace(/\.pdf$/i, '');
}

/* ---------- 下载 PDF ---------- */
async function readWithProgress(res, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(got, total);
  }
  const buf = new Uint8Array(got);
  let pos = 0;
  for (const c of chunks) {
    buf.set(c, pos);
    pos += c.length;
  }
  return buf;
}

function looksLikePdf(buf) {
  // %PDF 可能出现在前 1KB 内
  const head = new TextDecoder('latin1').decode(buf.subarray(0, 1024));
  return head.includes('%PDF');
}

async function downloadPdf(book, onProgress) {
  const { apiKey, proxy } = getSettings();
  let res;
  if (book.type === 'drive') {
    if (apiKey) {
      const url = `${API}/${encodeURIComponent(book.id)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(apiKey)}`;
      res = await fetch(url, { headers: rkHeaders(book.id, book.resourceKey) });
      if (!res.ok) throw await apiError(res);
    } else if (proxy) {
      let url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(book.id)}&export=download&confirm=t`;
      if (book.resourceKey) url += `&resourcekey=${encodeURIComponent(book.resourceKey)}`;
      res = await fetch(withProxy(url, proxy));
      if (!res.ok) throw new Error(`通过代理下载失败（${res.status}）`);
    } else {
      throw needAccess();
    }
  } else {
    try {
      res = await fetch(book.url);
    } catch (e) {
      if (!proxy) throw new Error('无法下载该 PDF（可能是对方网站不允许跨域访问）。可以在设置中配置 CORS 代理。');
      res = await fetch(withProxy(book.url, proxy));
    }
    if (!res.ok) throw new Error(`下载失败（${res.status}）`);
  }
  const buf = await readWithProgress(res, onProgress);
  if (!looksLikePdf(buf)) throw new Error('下载到的内容不是 PDF：请确认文件已公开分享，并且确实是 PDF 文件。');
  return buf;
}

// 优先读取本地缓存，否则下载并缓存。返回 Uint8Array
export async function getPdfData(book, onProgress) {
  const cached = await cache.getPdf(book.key);
  if (cached) return new Uint8Array(await cached.arrayBuffer());
  const buf = await downloadPdf(book, onProgress);
  cache.putPdf(book.key, new Blob([buf], { type: PDF_MIME }));
  return buf;
}

/* ---------- pdf.js ---------- */
export function pdfjs() {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('PDF 组件加载失败，请检查网络后刷新页面。');
  lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  return lib;
}

export async function openPdf(data) {
  const lib = pdfjs();
  return lib.getDocument({
    data,
    cMapUrl: PDFJS + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: PDFJS + 'standard_fonts/',
  }).promise;
}

/* ---------- 缩略图 ---------- */
export function driveThumbUrl(book, width = 480) {
  let u = `https://drive.google.com/thumbnail?id=${encodeURIComponent(book.id)}&sz=w${width}`;
  if (book.resourceKey) u += `&resourcekey=${encodeURIComponent(book.resourceKey)}`;
  return u;
}

// 用 pdf.js 渲染第一页，返回 JPEG Blob，并写入缓存
export async function renderThumb(book, width = 400) {
  const data = await getPdfData(book);
  const doc = await openPdf(data);
  try {
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp1.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (blob) await cache.put('thumb', book.key, blob);
    return blob;
  } finally {
    doc.destroy();
  }
}
