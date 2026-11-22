# 故事盒子 StoryBox

从 Google Drive 打开绘本 / 故事书 PDF，全屏阅读，带翻页动画。纯静态网站，可直接部署在 GitHub Pages。

## 页面

| 页面 | 作用 |
| --- | --- |
| `index.html` | 书架：显示所有已添加的绘本，缩略图是第一页。点击打开阅读。 |
| `setup.html` | 添加绘本（Drive 文件链接或公开文件夹链接，文件夹会自动找出全部 PDF，可含子文件夹）、改名、排序、删除、导入/导出书单，以及设置 API Key。 |
| `reader.html` | 阅读器。 |

## 阅读器操作

- 底部控制栏（类似音乐播放器）：全屏/退出全屏、单页/双页切换、第一页、上一页、页码、下一页、最后一页、退出阅读。
- 点击（或触摸）画面 **左侧 1/3** 上一页，**右侧 1/3** 下一页。
- 翻页时纸张会柔和地弯曲；也可以按住页面左右拖动，像真书一样慢慢翻，松手后自动翻完或弹回。
- 全屏时控制栏自动隐藏，**点击画面中间** 显示/隐藏控制栏；按 **Esc** 退出全屏。
- 键盘：← → / PageUp PageDown / 空格 翻页，Home / End 到第一页 / 最后一页，F 切换全屏。
- **单页 / 双页**：默认“自动”，根据屏幕方向和 PDF 页面比例决定（竖版绘本在横屏上用双页，横版绘本或竖屏手机用单页）。手动切换后会记住这本书的选择。默认版式可在设置页修改。
- 页面按每个 PDF 自己的比例缩放显示，尽量占满屏幕；双页时封面单独显示在右侧，之后两页一组。
- 会记住每本书读到哪一页；读过的 PDF 会缓存在浏览器里（IndexedDB，最多 15 本），再次打开更快。

## Google Drive 与 API Key（重要）

浏览器有跨域限制，网页不能直接从 `drive.google.com` 下载文件，需要一个免费的 Google Drive API Key（或者 CORS 代理）。
设置步骤和常见问题见 **[API_Guide.md](API_Guide.md)**。

## 书单保存在哪里

- 在 `setup.html` 添加的书保存在**当前浏览器**的 localStorage 中。
- 想让所有设备（例如孩子的平板）看到同一份书单：在设置页点“导出书单”，把得到的文件命名为 `books.json` 放在仓库根目录提交即可。网站会自动加载 `books.json`，与本机书单合并显示。

## 部署到 GitHub Pages

仓库 Settings → Pages → Source 选 “Deploy from a branch”，分支选 `main`、目录 `/ (root)`，保存后访问 `https://<用户名>.github.io/StoryBox/`。

## 本地运行

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

（需要通过 http 访问，直接双击打开 html 文件时 ES 模块无法加载。）

## 文件结构

```
index.html / setup.html / reader.html
style.css
books.json            站点共享书单（可选）
API_Guide.md          API Key 设置指南
js/config.js          站点默认配置（API Key、代理、默认版式）
js/store.js           书单、设置、进度、缓存
js/import.js          Drive 链接解析、文件夹抓取、PDF 下载、pdf.js
js/index.js           书架
js/setup.js           设置页
js/reader.js          阅读器
tools/cors-proxy-worker.js   可选的 Cloudflare Worker 代理
```

PDF 渲染使用 [pdf.js](https://mozilla.github.io/pdf.js/)（从 cdnjs 加载）。
