# Google Drive API Key 设置指南

[← 返回 README](README.md)

## 为什么需要 API Key

浏览器有跨域限制（CORS），网页**不能直接从 `drive.google.com` 下载文件内容**。所以故事盒子这样的静态网站要读取 Drive 上的 PDF，需要用下面两种方式之一。

## 方式一（推荐）：Google Drive API Key

公开分享（“知道链接的任何人”（Anyone with the link）+“查看者”（Viewer））的文件和文件夹，可以用一个免费的 API Key 通过 Drive API 读取，而 Drive API 支持跨域访问。

### 1. 创建项目并启用 Drive API

1. 打开 [Google Cloud 控制台（Google Cloud Console）](https://console.cloud.google.com/)，新建一个项目（New Project），例如 `StoryBox`。
2. 进入“API 和服务”（APIs & Services）→“库”（Library），搜索 **Google Drive API**，点“启用”（Enable）。
   启用后，详情页的“状态”（Status）会显示“已启用”（Enabled）。

### 2. 创建 API Key

1. 进入“API 和服务”（APIs & Services）→“凭据”（Credentials）。
2. 点上方的“创建凭据”（Create credentials）→“API 密钥”（API key）。
   如果系统询问要访问哪类数据，选“公开数据”（Public data）。
3. 页面上“配置 OAuth 同意屏幕”（Configure consent screen）的提示**不用理会**，那是给 OAuth 登录用的，故事盒子只用 API Key。

### 3. 限制这个 Key（强烈建议）

在凭据列表里点开这个 Key 进入编辑页：

- **应用限制（Application restrictions）**：选“网站”（Websites），在“网站限制”（Website restrictions）中添加你的网址，例如 `https://mrwengkb.github.io/*`。本地测试可以再加 `http://localhost:*/*`。
- **API 限制（API restrictions）**：选“限制密钥”（Restrict key），在下拉列表中**只勾选 Google Drive API**。
- **通过服务账号验证 API 调用（Authenticate API calls through a service account）**：保持**关闭**。在 Key 列表中，这一项对应“绑定账号”（Bound account）这一栏，应为空。
- 最后点“保存”（Save）。

> 新建的 Key 或修改后的限制**最多需要 5 分钟**才会生效。刚创建时如果出现 403，先等几分钟再试。

### 4. 把 Key 填到网站里

任选其一：

- 填到 `setup.html` 的“设置”中，只保存在当前浏览器；
- 填到 `js/config.js` 的 `apiKey` 中，所有设备打开网站都能直接用。

有了 API Key，添加文件时会自动读取书名；添加文件夹时会自动列出里面所有的 PDF，包括子文件夹（其他类型的文件，例如视频，会被跳过）。

> 写在 `config.js` 里的 Key 会公开在网页源码中。只要按第 3 步设置了网站限制和 API 限制，别人拿到 Key 也只能在你的网站上读取公开文件，风险很小。

## 方式二：CORS 代理

不想用 API Key 的话，也可以部署一个代理。例如 `tools/cors-proxy-worker.js` 可以直接部署到 Cloudflare Workers 的免费版。部署后在设置中填写 `https://<你的worker>.workers.dev/?url=`。

代理模式下，文件夹是通过解析 Drive 的“嵌入式文件夹视图”（embedded folder view）页面来抓取的，Google 改版时可能会失效。

## 常见问题

| 报错 | 原因与处理 |
| --- | --- |
| 403 Permission denied on the service | Key 刚创建，限制还没生效（等几分钟）；或者“API 限制”（API restrictions）里没有勾选 Google Drive API；或者 Key 绑定了服务账号（Bound account）。 |
| 403，并提到 referer / 来源 | “网站限制”（Website restrictions）里没有包含当前访问的网址。 |
| 404 找不到文件 | 链接不对，或者文件 / 文件夹没有设置为“知道链接的任何人”（Anyone with the link）可查看。 |
| 400 请求无效 | API Key 填错了。 |

## 其他说明

- 文件和文件夹都必须公开分享：“知道链接的任何人”（Anyone with the link）+“查看者”（Viewer）。
- 书架缩略图优先使用 Drive 自带的缩略图（就是第一页）。取不到时，会下载 PDF 用 pdf.js 渲染第一页并缓存。
- 也可以添加任何允许跨域访问的 PDF 直链，比如把 PDF 直接放在本仓库里：`https://mrwengkb.github.io/StoryBox/books/xxx.pdf`。
