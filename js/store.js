// 书单、设置、阅读进度（localStorage）以及 PDF / 缩略图缓存（IndexedDB）

const BOOKS_KEY = 'storybox.books';
const HIDDEN_KEY = 'storybox.hidden';
const SETTINGS_KEY = 'storybox.settings';
const PROGRESS_KEY = 'storybox.progress';

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const config = () => window.STORYBOX_CONFIG || {};

/* ---------- 设置 ---------- */
export function getSettings() {
  const c = config();
  const s = lsGet(SETTINGS_KEY, {});
  return {
    apiKey: (s.apiKey ?? '') || c.apiKey || '',
    proxy: (s.proxy ?? '') || c.proxy || '',
    viewMode: s.viewMode || c.defaultViewMode || 'auto',
  };
}
export function getSavedSettings() {
  return lsGet(SETTINGS_KEY, {});
}
export function saveSettings(patch) {
  lsSet(SETTINGS_KEY, { ...lsGet(SETTINGS_KEY, {}), ...patch });
}

/* ---------- 书单 ---------- */
// book: { key, type: 'drive'|'url', id?, resourceKey?, url?, name, addedAt, shared? }
export function bookKey(b) {
  return b.key || (b.type === 'drive' || b.id ? 'drive:' + b.id : 'url:' + b.url);
}
function normalize(b, shared) {
  const type = b.type || (b.id ? 'drive' : 'url');
  const out = { ...b, type };
  out.key = bookKey(out);
  if (shared) out.shared = true;
  return out;
}

export function getLocalBooks() {
  return lsGet(BOOKS_KEY, []).map((b) => normalize(b, false));
}
export function saveLocalBooks(list) {
  return lsSet(
    BOOKS_KEY,
    list.filter((b) => !b.shared).map(({ shared, ...b }) => b)
  );
}

let sharedPromise = null;
export function getSharedBooks() {
  if (!sharedPromise) {
    const url = config().booksUrl;
    sharedPromise = url
      ? fetch(url, { cache: 'no-cache' })
          .then((r) => (r.ok ? r.json() : []))
          .then((list) => (Array.isArray(list) ? list.map((b) => normalize(b, true)) : []))
          .catch(() => [])
      : Promise.resolve([]);
  }
  return sharedPromise;
}

export function getHidden() {
  return new Set(lsGet(HIDDEN_KEY, []));
}
export function setHidden(set) {
  lsSet(HIDDEN_KEY, [...set]);
}

// 本机书单 + 站点共享书单（去重，排除已隐藏的共享书）
export async function getAllBooks() {
  const local = getLocalBooks();
  const shared = await getSharedBooks();
  const hidden = getHidden();
  const seen = new Set(local.map((b) => b.key));
  const out = [...local];
  for (const b of shared) {
    if (!seen.has(b.key) && !hidden.has(b.key)) {
      seen.add(b.key);
      out.push(b);
    }
  }
  return out;
}

export async function findBook(key) {
  return (await getAllBooks()).find((b) => b.key === key) || null;
}

// 返回 true 表示新增，false 表示已存在
export function addBook(book) {
  const list = getLocalBooks();
  const b = normalize({ addedAt: Date.now(), ...book }, false);
  const hidden = getHidden();
  if (hidden.delete(b.key)) setHidden(hidden);
  const i = list.findIndex((x) => x.key === b.key);
  if (i >= 0) return false;
  list.push(b);
  saveLocalBooks(list);
  return true;
}

/* ---------- 阅读进度 ---------- */
export function getProgress(key) {
  return lsGet(PROGRESS_KEY, {})[key] || 1;
}
export function setProgress(key, page) {
  const p = lsGet(PROGRESS_KEY, {});
  p[key] = page;
  lsSet(PROGRESS_KEY, p);
}

/* ---------- IndexedDB 缓存 ---------- */
const DB_NAME = 'storybox';
const STORES = ['pdf', 'thumb'];
const MAX_PDFS = 15;
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          for (const s of STORES) {
            if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const t = db.transaction(store, mode);
          const req = fn(t.objectStore(store));
          t.oncomplete = () => resolve(req ? req.result : undefined);
          t.onerror = t.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

export const cache = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  put: (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key)),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  clear: async () => {
    for (const s of STORES) await tx(s, 'readwrite', (st) => st.clear());
  },
  async putPdf(key, blob) {
    await this.put('pdf', key, { blob, at: Date.now() });
    // 只保留最近使用的若干本，避免占满存储空间
    const all = await tx('pdf', 'readonly', (s) => s.getAllKeys());
    if (all && all.length > MAX_PDFS) {
      const items = await Promise.all(all.map(async (k) => [k, (await this.get('pdf', k))?.at || 0]));
      items.sort((a, b) => a[1] - b[1]);
      for (const [k] of items.slice(0, all.length - MAX_PDFS)) await this.del('pdf', k);
    }
  },
  async getPdf(key) {
    const v = await this.get('pdf', key);
    if (v && v.blob) {
      this.put('pdf', key, { blob: v.blob, at: Date.now() });
      return v.blob;
    }
    return null;
  },
};

/* ---------- 每本书的版式选择（单页 / 双页） ---------- */
const MODE_KEY = 'storybox.viewmode';
export function getBookViewMode(key) {
  return lsGet(MODE_KEY, {})[key] || getSettings().viewMode;
}
export function setBookViewMode(key, mode) {
  const m = lsGet(MODE_KEY, {});
  m[key] = mode;
  lsSet(MODE_KEY, m);
}
