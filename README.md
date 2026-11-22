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
- 点击（或触摸）画面 **左侧 1/3** 上一页，**右侧 1/3** 下一页；也可以左右滑动。
- 全屏时控制栏自动隐藏，**点击画面中间** 显示/隐藏控制栏；按 **Esc** 退出全屏。
- 键盘：← → / PageUp PageDown / 空格 翻页，Home / End 到第一页 / 最后一页，F 切换全屏。
- **单页 / 双页**：默认“自动”，根据屏幕方向和 PDF 页面比例决定（竖版绘本在横屏上用双页，横版绘本或竖屏手机用单页）。手动切换后会记住这本书的选择。默认版式可在设置页修改。
- 页面按每个 PDF 自己的比例缩放显示，尽量占满屏幕；双页时封面单独显示在右侧，之后两页一组。
- 会记住每本书读到哪一页；读过的 PDF 会缓存在浏览器里（IndexedDB，最多 15 本），再次打开更快。

## Google Drive 的限制与 API Key（重要）

浏览器出于跨域（CORS）限制，**不能直接从 `drive.google.com` 下载文件内容**，所以静态网页需要以下任一方式：

### 方式一（推荐）：Google Drive API Key

公开分享（“知道链接的任何人都可查看”）的文件和文件夹，可以用一个免费的 API Key 通过 Drive API 读取，Drive API 支持跨域访问。

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，新建一个项目。
2. 在“API 和服务 → 库”中启用 **Google Drive API**。
3. 在“API 和服务 → 凭据”中“创建凭据 → API 密钥”。
4. 强烈建议限制这个密钥：
   - **应用限制**：选“网站”，添加你的网址，例如 `https://mrwengkb.github.io/*`（本地测试可再加 `http://localhost:*/*`）。
   - **API 限制**：只允许 Google Drive API。
5. 把密钥填到 `setup.html` 的“设置”里（只保存在当前浏览器），或者填到 `js/config.js` 的 `apiKey`，这样所有设备打开网站都能直接用。

有了 API Key，添加文件时会自动读取书名，添加文件夹时会自动列出里面的所有 PDF。

> 密钥写在 `config.js` 里会公开在网页源码中。只要按上面第 4 步做了网址和 API 限制，别人拿到也只能在你的网站上读取公开文件，风险很小。

### 方式二：CORS 代理

不想用 API Key，也可以部署一个代理（例如 `tools/cors-proxy-worker.js`，可直接部署到 Cloudflare Workers 免费版），然后在设置里填写 `https://<你的worker>.workers.dev/?url=`。代理模式下文件夹是通过解析 Drive 的“嵌入式文件夹视图”页面来抓取的，Google 改版时可能失效。

### 其他说明

- 文件和文件夹必须设置为“知道链接的任何人都可查看”。
- 书架缩略图优先使用 Drive 自带的缩略图（就是第一页）；取不到时会下载 PDF 用 pdf.js 渲染第一页并缓存。
- 也可以添加任何允许跨域访问的 PDF 直链，比如把 PDF 直接放在本仓库里：`https://mrwengkb.github.io/StoryBox/books/xxx.pdf`。

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
js/config.js          站点默认配置（API Key、代理、默认版式）
js/store.js           书单、设置、进度、缓存
js/import.js          Drive 链接解析、文件夹抓取、PDF 下载、pdf.js
js/index.js           书架
js/setup.js           设置页
js/reader.js          阅读器
tools/cors-proxy-worker.js   可选的 Cloudflare Worker 代理
```

PDF 渲染使用 [pdf.js](https://mozilla.github.io/pdf.js/)（从 cdnjs 加载）。
