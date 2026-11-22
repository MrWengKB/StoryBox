// 站点默认配置（可选）。
// 在这里填写的值会作为所有访问者的默认设置；setup.html 中保存的设置会覆盖这里的值。
// 注意：这里的 API Key 会公开在网页源码里，请务必在 Google Cloud Console 中
// 把它限制为“仅 Google Drive API”并限制 HTTP 来源（你的 GitHub Pages 域名）。
window.STORYBOX_CONFIG = {
  apiKey: 'AIzaSyBoNFN2gf-EJ_LwYsN6Jrk8xo4XTLVM5_s', // Google Drive API Key
  proxy: '',           // 可选：CORS 代理前缀，例如 'https://your-worker.workers.dev/?url='
  // 站点共享书单（所有设备都能看到）：可以是网站内的 'books.json'，
  // 也可以是 Google Drive 上公开分享的 JSON 文件链接，例如
  // 'https://drive.google.com/file/d/xxxxxxxx/view?usp=sharing'；留空则不加载
  booksUrl: 'books.json',
  defaultViewMode: 'auto' // 阅读默认版式：'auto' | 'single' | 'double'
};
