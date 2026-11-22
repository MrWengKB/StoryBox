// 设置页：添加绘本、管理书单、保存设置

import {
  getAllBooks, getLocalBooks, saveLocalBooks, addBook, getHidden, setHidden,
  getSettings, getSavedSettings, saveSettings, cache,
} from './store.js';
import { parseDriveUrl, getFileMeta, listFolder, stripPdf } from './import.js';

const $ = (id) => document.getElementById(id);
const logEl = $('log');

function log(msg, cls = '') {
  logEl.hidden = false;
  const p = document.createElement('div');
  if (cls) p.className = cls;
  p.textContent = msg;
  logEl.appendChild(p);
  logEl.scrollTop = logEl.scrollHeight;
  return p;
}

function splitLine(line) {
  const m = line.match(/^(.*?)\s*(https?:\/\/\S+)\s*$/);
  if (m) return { name: m[1].trim(), link: m[2] };
  return { name: '', link: line.trim() };
}

function nameFromUrl(url) {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return stripPdf(last) || '未命名';
  } catch {
    return '未命名';
  }
}

async function addOne(line, recursive) {
  const { name, link } = splitLine(line);
  const p = parseDriveUrl(link);
  if (!p) return log(`✗ 无法识别：${link}`, 'err');

  if (p.kind === 'url') {
    const ok = addBook({ type: 'url', url: p.url, name: name || nameFromUrl(p.url) });
    return log(ok ? `✓ 已添加：${name || nameFromUrl(p.url)}` : `· 已存在：${p.url}`, ok ? 'ok' : '');
  }

  let kind = p.kind;
  let meta = null;
  try {
    meta = await getFileMeta(p.id, p.resourceKey);
  } catch (e) {
    return log(`✗ ${link}\n  ${e.message}`, 'err');
  }
  if (meta) kind = meta.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file';
  if (kind === 'unknown') kind = 'file';

  if (kind === 'folder') {
    const status = log(`… 正在读取文件夹${meta ? '“' + meta.name + '”' : ''}`);
    try {
      const files = await listFolder(p.id, p.resourceKey || meta?.resourceKey || '', {
        recursive,
        onProgress: (n, prefix) => (status.textContent = `… 正在读取文件夹 ${prefix || ''}（已找到 ${n} 个 PDF）`),
      });
      let added = 0;
      for (const f of files) if (addBook({ type: 'drive', id: f.id, resourceKey: f.resourceKey, name: f.name })) added++;
      status.className = 'ok';
      status.textContent = `✓ 文件夹${meta ? '“' + meta.name + '”' : ''}：找到 ${files.length} 个 PDF，新增 ${added} 本`;
    } catch (e) {
      status.className = 'err';
      status.textContent = `✗ 读取文件夹失败：${e.message}`;
    }
    return;
  }

  if (meta && meta.mimeType !== 'application/pdf' && !/\.pdf$/i.test(meta.name)) {
    return log(`✗ 不是 PDF 文件：${meta.name}（${meta.mimeType}）`, 'err');
  }
  const bookName = name || (meta ? stripPdf(meta.name) : '') || `绘本 ${p.id.slice(0, 6)}`;
  const ok = addBook({ type: 'drive', id: p.id, resourceKey: p.resourceKey || meta?.resourceKey || '', name: bookName });
  log(ok ? `✓ 已添加：${bookName}` : `· 已存在：${bookName}`, ok ? 'ok' : '');
}

$('addBtn').addEventListener('click', async () => {
  const lines = $('links').value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const btn = $('addBtn');
  btn.disabled = true;
  logEl.innerHTML = '';
  if (!getSettings().apiKey) {
    log('提示：未设置 API Key，无法自动读取书名和文件夹内容；阅读 Drive 文件也需要 API Key 或代理。', 'warn');
  }
  for (const line of lines) await addOne(line, $('recursive').checked);
  btn.disabled = false;
  $('links').value = '';
  renderList();
});

/* ---------- 书单列表 ---------- */
function moveBook(key, delta) {
  const list = getLocalBooks();
  const i = list.findIndex((b) => b.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveLocalBooks(list);
  renderList();
}

function removeBook(book) {
  if (book.shared) {
    const h = getHidden();
    h.add(book.key);
    setHidden(h);
  } else {
    saveLocalBooks(getLocalBooks().filter((b) => b.key !== book.key));
  }
  cache.del('thumb', book.key);
  cache.del('pdf', book.key);
  renderList();
}

function renameBook(book, name) {
  const list = getLocalBooks();
  const b = list.find((x) => x.key === book.key);
  if (b) {
    b.name = name;
    saveLocalBooks(list);
  } else {
    // 共享书单中的书：在本机保存一份带新名字的副本
    addBook({ ...book, shared: undefined, name });
  }
}

function sourceLabel(b) {
  if (b.shared) return '共享书单';
  return b.type === 'drive' ? 'Google Drive' : (() => { try { return new URL(b.url).hostname; } catch { return '链接'; } })();
}

async function renderList() {
  const books = await getAllBooks();
  $('count').textContent = books.length ? `（${books.length}）` : '';
  const ul = $('list');
  ul.innerHTML = '';
  if (!books.length) {
    ul.innerHTML = '<li class="muted empty-row">还没有添加任何绘本</li>';
    return;
  }
  for (const b of books) {
    const li = document.createElement('li');
    li.innerHTML = `
      <input class="name" type="text" aria-label="书名">
      <span class="src muted"></span>
      <a class="icon-btn" title="阅读" aria-label="阅读">📖</a>
      <button class="icon-btn up" title="上移" aria-label="上移">↑</button>
      <button class="icon-btn down" title="下移" aria-label="下移">↓</button>
      <button class="icon-btn del" title="删除" aria-label="删除">✕</button>`;
    const input = li.querySelector('.name');
    input.value = b.name || '';
    input.addEventListener('change', () => renameBook(b, input.value.trim() || '未命名'));
    li.querySelector('.src').textContent = sourceLabel(b);
    li.querySelector('a').href = 'reader.html?book=' + encodeURIComponent(b.key);
    if (b.shared) {
      li.querySelector('.up').disabled = true;
      li.querySelector('.down').disabled = true;
    }
    li.querySelector('.up').onclick = () => moveBook(b.key, -1);
    li.querySelector('.down').onclick = () => moveBook(b.key, 1);
    li.querySelector('.del').onclick = () => {
      if (confirm(`从书架移除“${b.name}”？`)) removeBook(b);
    };
    ul.appendChild(li);
  }
}

$('clearBtn').addEventListener('click', async () => {
  if (!confirm('确定删除全部绘本？（共享书单中的书会被隐藏）')) return;
  const all = await getAllBooks();
  const h = getHidden();
  for (const b of all) if (b.shared) h.add(b.key);
  setHidden(h);
  saveLocalBooks([]);
  await cache.clear();
  renderList();
});

$('exportBtn').addEventListener('click', async () => {
  const books = (await getAllBooks()).map(({ key, shared, ...b }) => b);
  const blob = new Blob([JSON.stringify(books, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'books.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    if (!Array.isArray(list)) throw new Error('格式不正确');
    let n = 0;
    for (const b of list) if ((b.id || b.url) && addBook(b)) n++;
    alert(`导入完成，新增 ${n} 本。`);
  } catch (err) {
    alert('导入失败：' + err.message);
  }
  e.target.value = '';
  renderList();
});

/* ---------- 设置 ---------- */
function loadSettings() {
  const saved = getSavedSettings();
  const eff = getSettings();
  $('apiKey').value = saved.apiKey ?? eff.apiKey;
  $('proxy').value = saved.proxy ?? eff.proxy;
  $('viewMode').value = eff.viewMode;
}

$('saveBtn').addEventListener('click', () => {
  saveSettings({
    apiKey: $('apiKey').value.trim(),
    proxy: $('proxy').value.trim(),
    viewMode: $('viewMode').value,
  });
  $('settingsMsg').textContent = '✓ 已保存';
  setTimeout(() => ($('settingsMsg').textContent = ''), 2500);
});

$('clearCacheBtn').addEventListener('click', async () => {
  await cache.clear();
  $('settingsMsg').textContent = '✓ 缓存已清除';
  setTimeout(() => ($('settingsMsg').textContent = ''), 2500);
});

loadSettings();
renderList();
