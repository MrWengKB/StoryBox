// 书架页：显示所有绘本及第一页缩略图

import { getAllBooks, cache } from './store.js';
import { driveThumbUrl, renderThumb } from './import.js';

const shelf = document.getElementById('shelf');
const empty = document.getElementById('empty');

// 依次渲染缩略图，避免同时下载太多 PDF
const queue = [];
let running = 0;
const CONCURRENCY = 2;
function enqueue(job) {
  queue.push(job);
  pump();
}
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    running++;
    job().finally(() => {
      running--;
      pump();
    });
  }
}

function showBlob(img, blob) {
  img.src = URL.createObjectURL(blob);
  img.closest('.cover').classList.add('loaded');
}

function fallbackRender(book, img) {
  const cover = img.closest('.cover');
  cover.classList.add('rendering');
  enqueue(async () => {
    try {
      const blob = await renderThumb(book);
      if (blob) showBlob(img, blob);
      else throw new Error('no blob');
    } catch (e) {
      cover.classList.add('failed');
      cover.title = e.message || '';
    } finally {
      cover.classList.remove('rendering');
    }
  });
}

async function setupThumb(book, img) {
  const cached = await cache.get('thumb', book.key);
  if (cached) return showBlob(img, cached);
  if (book.type === 'drive') {
    // 先尝试 Drive 自带的缩略图（就是第一页），失败再用 pdf.js 渲染
    img.onload = () => img.closest('.cover').classList.add('loaded');
    img.onerror = () => {
      img.onerror = null;
      img.removeAttribute('src');
      fallbackRender(book, img);
    };
    img.referrerPolicy = 'no-referrer';
    img.src = driveThumbUrl(book);
  } else {
    fallbackRender(book, img);
  }
}

function card(book) {
  const a = document.createElement('a');
  a.className = 'book';
  a.href = 'reader.html?book=' + encodeURIComponent(book.key);
  a.innerHTML = `
    <div class="cover">
      <img alt="" loading="lazy">
      <div class="cover-placeholder"><span>📖</span></div>
    </div>
    <div class="title"></div>`;
  a.querySelector('.title').textContent = book.name || '未命名';
  a.title = book.name || '';
  setupThumb(book, a.querySelector('img'));
  return a;
}

(async () => {
  const books = await getAllBooks();
  if (!books.length) {
    empty.hidden = false;
    return;
  }
  for (const b of books) shelf.appendChild(card(b));
})();
