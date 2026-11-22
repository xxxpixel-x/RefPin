# RefPin · 浮页 · v0.3.0

**把图留在引用它的段落旁边。** RefPin 是一款本地优先的学术 PDF 阅读器，也可以作为 Chrome 侧边栏使用。悬停引用即可预览，把需要比较的几张图钉在一起，就能接着往下读。

[English](./README.md) | 简体中文

[![Latest Release](https://img.shields.io/github/v/release/xxxpixel-x/RefPin?color=D97706&label=Release)](https://github.com/xxxpixel-x/RefPin/releases/latest)
[![CI](https://github.com/xxxpixel-x/RefPin/actions/workflows/ci.yml/badge.svg)](https://github.com/xxxpixel-x/RefPin/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-1C1917)](./LICENSE)
![Local-First](https://img.shields.io/badge/Local--First-offline_core-D97706)
![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-78716C)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-78716C)

> **不想折腾代码或 Node.js，只想直接装插件？**
> 前往 [**GitHub Releases**](https://github.com/xxxpixel-x/RefPin/releases/latest) 下载 **`RefPin-Extension-v*.zip`**，解压后双击 **`INSTALL-GUIDE.html`**，跟着 3 步图文向导即可装好（支持 Windows / macOS / Linux）。

## 为什么做 RefPin？

读到一半，作者让你看图 2、对照表 1，再把结果代入式 (3)。等翻齐了这几页，刚才读到哪一句往往已经忘了。遇到 [14]、(Vaswani et al., 2017)，或十页前定义过的缩写，也会有同样的问题。浮页把相关内容带到当前段落。确实需要跳页时，读完点一下就能回到刚才那一行。

## 主要功能

| 网页阅读器 | 使用方式 |
| --- | --- |
| 双通道引用识别 | 同时读取 PDF 原生内部链接，并在文本层中匹配引用。支持 [14] 等数字文献、作者–年份、上标，以及中英文的图、表和公式编号。 |
| 悬停预览与全文术语表 | 在引用处直接查看图表、公式和文献。遇到 MHA 等文内定义过的缩写，悬停即可看到全称、定义原句及所在页。 |
| 四向对照钉板 | 多张图表可并排对照，钉板可拖至上、下、左、右任一侧。**当前页自动伴读（Auto-Sync）** 列出本页引用的跨页图表与公式。任意区域都可框选，裁切范围支持向上、向下扩展和一键还原。 |
| 引用回链 | 在图表或文献卡片上查看识别到的正文引用。点击页码即可跳到对应的那一次提及，同一页的多处引用也可分别定位。 |
| 精读笔记 | 在钉板中选择「导出笔记」。复制 Markdown，或下载包含 `notes.md` 与 2.5 倍分辨率图像的 Obsidian ZIP。笔记保留钉选顺序、引用页、BibTeX 和术语表。 |
| 参考文献补全 | 离线即可复制 BibTeX。开启联网补全后，可查看 OpenAlex 或 Crossref 提供的期刊、被引次数、摘要及开放获取 PDF。 |
| 命令面板 | 输入 `f2`、`alg1`、`[14]` 或 `:8` 定位图表、算法、文献或页码。也可检索目录、术语和阅读设置。 |
| 阅读导航 | 按目录跳转、全文搜索、沿跳转历史返回或前进。阅读标尺支持逐行移动，提供浅色、暖纸和深色主题。 |
| 打开在线论文 | 在首页粘贴 arXiv 编号、OpenReview 链接或公开 PDF 链接。也可分享 `?arxiv=1706.03762`。 |
| 文本选取与净化复制 | 直接在 PDF 上选字。净化复制会合并换行、修复断词。需要翻译时，可将选文交给兼容 OpenAI 的接口或本机 Ollama 模型。 |
| 本地阅读档案 | 「最近阅读」通过 IndexedDB 保存页码、缩放、滚动位置和钉板。裁切只保存坐标，重新打开论文时再生成预览。 |
| 长文档按需渲染 | 各页共用一个 `IntersectionObserver` 追踪可见区域。远离视口的页面释放画布缓冲区和文本层，并保留原有布局位置。 |

**Chrome MV3 伴读侧边栏**可配合 arXiv、OpenReview、ACL Anthology、IEEE、Nature、Springer、PubMed/PMC 及本地 PDF 使用。在论文网页上直接提取可用的 HTML 内容；阅读 PDF 时，可在侧栏提取图表，也可框选当前标签页的可见画面。按需开启翻译后，可切换原文、仅译文或双语视图。**EN / 中文** 会同步切换侧栏、页面浮层和双语 PDF 阅读器的界面。浏览器工具栏标题和原生右键菜单跟随浏览器界面语言。

在支持的论文页面上点击「在 RefPin 中精读」即可打开侧栏。带 PDF 的浮标还可直接开启双语 PDF 阅读。点击 × 在当前标签页隐藏浮标，按住 Shift 点击可在本站永久隐藏。

## 跨平台支持

| 使用方式 | 平台与浏览器 |
| --- | --- |
| 网页阅读器 | 适用于 Windows、macOS、Linux 上的现代浏览器，包括 Chrome、Edge、Firefox，以及 macOS 上的 Safari。 |
| 伴读扩展 | 适用于 Windows、macOS、Linux 上实现了 `chrome.sidePanel` 的 Chromium 浏览器。基础版本为 Chrome 114+ 或 Edge 114+。Brave、Arc、Vivaldi 的可用性取决于具体版本及侧边栏实现。 |

Chromium 114–115 可从浏览器的侧边栏手动打开浮页。通过右键菜单或钉选动作主动唤起侧栏，需要 Chrome 116 引入的接口。Safari 和 Firefox 用户可使用网页阅读器，扩展依赖 Chromium 侧边栏接口。[Chrome 侧边栏文档](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

## 快速开始

### 方式一 · 直接下载预编译插件（零代码、无需安装 Node.js）

适用于 **Windows、macOS、Linux**（Chrome 114+、Edge 114+、Brave、Arc、Vivaldi）：

1. 前往 [**GitHub Releases**](https://github.com/xxxpixel-x/RefPin/releases/latest) 下载 **`RefPin-Extension-v*.zip`**，并完整解压到一个不会误删的文件夹。
2. 双击压缩包里的 **`INSTALL-GUIDE.html`** 查看 3 步交互式图文向导（离线打开、自动适配 Windows / macOS / Linux 快捷键、不触发系统安全拦截，支持一键复制扩展页地址），**或直接按以下步骤安装**：
   - 打开 `chrome://extensions`（或 `edge://extensions`），开启**开发者模式**。
   - 直接把 **`RefPin-Extension`** 文件夹拖进浏览器扩展页窗口（或点击**加载已解压的扩展程序**选中它）。
3. 将 RefPin 图标固定到工具栏即可伴读任意论文。阅读电脑上的 `file://` 本地 PDF 时，请在扩展详情页开启**允许访问文件网址**（也可直接把 PDF 拖进侧边栏）。

| Release 压缩包 | 用途 |
| --- | --- |
| `RefPin-Extension-v*.zip` | 面向普通用户（Windows / macOS / Linux 通用），内含免编译插件目录 `RefPin-Extension/` 与离线中英双语 `INSTALL-GUIDE.html`。 |
| `RefPin-Store-Package-v*.zip` | 面向应用商店提审，`manifest.json` 位于根目录，可直接上传 Chrome Web Store 或 Microsoft Edge 外接程序商店。 |

### 方式二 · 从源码运行网页阅读器或自行构建

使用 Node.js 20 或更高版本，在项目目录运行：

```sh
npm install
npm run dev
```

打开 Vite 输出的本机地址，拖入一份 PDF 即可阅读。也可以选择《Attention Is All You Need》，从第 4 页开始体验引用预览。另一份样张可用于体验中文双栏排版。[查看样本来源](./public/samples/NOTICE.md)

```sh
npm test
npm run build
npm run pack:ext
```

- `npm run build`：构建网页版至 `dist/`。
- `npm run build:ext`：构建未打包扩展至 `dist-ext/`。
- `npm run pack:ext`：一键生成 `release/RefPin-Extension-v*.zip`（Win/macOS/Linux 免编译分发包）与 `release/RefPin-Store-Package-v*.zip`（Chrome / Edge 商店提审包）。

在 GitHub 仓库的 **Settings → Pages → Source** 中选择 **GitHub Actions**。推送到 `main` 后，工作流会构建并部署 `dist/`。静态文件、示例和离线缓存均可在 `/RefPin/` 等子路径下使用。

## 快捷键

| 按键 | 适用位置 | 操作 |
| --- | --- | --- |
| `Ctrl/Cmd+F` | 网页阅读器 | 搜索论文正文。 |
| `Ctrl/Cmd+K` | 网页阅读器 | 打开或关闭命令面板。 |
| `↑/↓`、`Enter`、`Shift+Enter` | 命令面板 | 选择、执行或直接钉住图表或文献。 |
| `Alt+←/→` | 网页阅读器 | 沿跳转历史后退或前进。 |
| `R`、`Alt+↑/↓` | 网页阅读器 | 切换阅读标尺，或将标尺向上、向下移动一行。 |
| `S` | 网页阅读器 | 切换自由框选，拖出选区后松手即可钉住。 |
| `[` | 网页阅读器 | 展开或收起全篇资产抽屉。 |
| `Enter` | 网页阅读器页码输入框 | 跳至输入的页码。 |
| `Esc` | 网页阅读器 | 关闭预览或灯箱，或取消框选。 |
| `Alt` + `S` | 已激活伴读的 HTML 论文页 | 在原页面开始框选。 |
| `Enter` / `Esc` | 扩展截图选区窗口 | 确认钉住 / 取消。 |

## 隐私与本地优先架构

在本机启动后，核心阅读功能可 **100% 离线运行**。PDF.js、工作线程、字体、字符映射和示例 PDF 均随项目提供。解析、预览、术语抽取、回链和归档都在浏览器内完成。RefPin 没有论文上传服务或流量分析。打开在线论文时，会向原站读取文件。

导出笔记和生成离线 BibTeX 均在设备内完成。联网补全默认关闭。开启后，阅读器会用 DOI 或文献标题（没有标题时使用引用文本）查询 OpenAlex 和 Crossref，并在本地保留最近 200 条结果。打开论文链接时，扩展可代取支持的学术站点 PDF，最大 40 MiB。普通 HTTPS PDF 使用浏览器直接读取。若原站限制跨域，可下载后拖入，或自行指定代理并点击重试。在自托管的 HTTPS 阅读器上，可通过扩展右键菜单为当前标签页启用 PDF 代取。

网页端最多保留 30 条阅读档案，并可缓存 5 份每份不超过 15 MiB 的本地 PDF。较大的文件或已被移出缓存的文件，下次重新选择同一份即可恢复钉板和进度。清除浏览器站点数据也会清除阅读档案。

翻译由你主动开启。网页端把选文及配置的认证信息发送至指定端点，选择本机 Ollama 可让请求留在设备上。扩展的整页翻译会分批发送提取的文本。免费模式使用 Microsoft Edge、Google 翻译和 MyMemory 的非官方通道，可用性与请求额度会变化。需要稳定服务时，可选择**自定义 API** 并填写密钥；密钥留空会回退到免费通道。配置和密钥保存在当前浏览器配置文件中。

| 扩展权限 | 用途 |
| --- | --- |
| `sidePanel`、`contextMenus` | 显示伴读侧栏，并在右键菜单中提供开侧栏和框选操作。 |
| `tabs`、`activeTab` | 跟随当前论文、切换 PDF 译文视图，并在用户框选时截取可见标签页。 |
| `storage` | 保存本机配置与界面语言，并将待处理的钉选交给刚打开的侧栏。 |
| `<all_urls>` | 读取不同出版平台的论文页、获取关联 PDF 并访问所选翻译端点。内容脚本匹配 HTTP(S) 页面，本地文件访问由浏览器单独控制。 |

## 项目结构

```text
RefPin/
├── src/
│   ├── engine/       # 纯前端 PDF 解析、引用/术语/回链识别、WebP 裁切与 Vitest 回归测试
│   ├── components/   # 网页阅读器 UI（PdfViewer、HoverPeekCard、SelectionToolbar、PinDock、AssetDrawer、LandingView）
│   ├── storage/      # 原生 IndexedDB 本地阅读档案与容量受控的 PDF 缓存
│   ├── services/     # 解耦翻译服务（网页端兼容 OpenAI/Ollama，扩展端独立适配）
│   ├── i18n/         # 共享零依赖中英双语词典与实时语言切换
│   ├── store/        # Zustand 全局阅读状态
│   └── extension/    # Chrome MV3 伴读扩展（manifest、_locales、background、content、sidepanel、pdfTranslate）
├── scripts/          # 跨平台 build-extension.mjs 与 pack-extension.mjs（免编译 ZIP + 离线安装向导）
└── .github/workflows/# CI 自动校验与 Tag 自动发布 GitHub Release
```

## 路线图

- [x] **阶段 0 · 开源基建与引擎加固。** Vitest 回归测试、GitHub Actions CI、WebP 裁图、`AbortSignal` 取消、防脱附 PDF 指纹、加密/扫描 PDF 友好兜底，以及 Win/macOS/Linux 免编译 Release 自动打包。
- [x] **阶段 1 · 核心伴读与双语化。** 图表/文献双向引用回链、可选中文本层 + 净化复制 + 按需翻译、离屏 Canvas 与文本层内存回收、IndexedDB 本地档案与最近阅读、当前页自动伴读（Auto-Sync）、全文缩写/术语浮窗、Author-Year 与上标引用，以及网页端与扩展全量 **EN / 简体中文** 双语界面。
- [x] **阶段 2 · 主力日常阅读器。** `Algorithm` / `Theorem` / `Section` 识别、PDF 原生目录与 `Ctrl+F` 全文搜索、多步跳转历史栈（`Alt+←/→`）与视觉阅读标尺、深色 / 暖纸护眼模式，以及 PWA 文件关联。
- [x] **阶段 3 · 科研工作流与扩展集成。** Markdown 与 Obsidian 图文包、可选文献补全与 BibTeX、命令面板、学术页面浮标、arXiv 直开、GitHub Pages 部署工作流，以及 Chrome / Edge 商店提审包。

## 参与贡献

反馈引用漏识别时，请附上原文、页码、期望定位的位置，以及方便分享的样本。反馈扩展问题时，请注明浏览器版本及论文类型（HTML、在线 PDF 或本地文件）。新增界面文案时，请同步更新 `src/i18n/locales/` 中的两份词典，并运行上面的测试和两项构建。欢迎提交 Pull Request。

## 许可证

RefPin 源代码采用 [MIT 许可证](./LICENSE)。示例论文及 PDF.js 资源各自保留原有权利声明。[示例文件说明](./public/samples/NOTICE.md)
