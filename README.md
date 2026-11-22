# RefPin

**Keep the figure beside the paragraph that cites it.** RefPin is a local-first academic PDF reader and a Chrome companion side panel. Hover over a citation for a preview, or pin several figures while you follow the argument.

English | [简体中文](./README.zh-CN.md)

[![Latest Release](https://img.shields.io/github/v/release/xxxpixel-x/RefPin?color=D97706&label=Release)](https://github.com/xxxpixel-x/RefPin/releases/latest)
[![CI](https://github.com/xxxpixel-x/RefPin/actions/workflows/ci.yml/badge.svg)](https://github.com/xxxpixel-x/RefPin/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/License-MIT-1C1917)](./LICENSE)
![Local-First](https://img.shields.io/badge/Local--First-offline_core-D97706)
![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-78716C)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-78716C)

> **Want to try the browser extension without installing Node.js?**
> Download **`RefPin-Extension-v*.zip`** from [**GitHub Releases**](https://github.com/xxxpixel-x/RefPin/releases/latest), unzip it, and open **`INSTALL-GUIDE.html`** for a 3-step visual walkthrough (Windows / macOS / Linux).

## Why RefPin?

A paragraph mentions Fig. 2, compares it with Table 1, and applies Eq. (3). By the time you find all three, you’ve lost your place. The same thing happens with [14], (Vaswani et al., 2017), or an acronym defined ten pages earlier. RefPin brings the cited material to the passage. When you do follow a link, a return button takes you back to the line you were reading.

## Key features

| In the web reader | What you can do |
| --- | --- |
| Dual-path citation recognition | Follow native PDF links and detect citations in the text layer. Patterns cover numeric references such as [14], author–year citations, superscripts, and English and Chinese figure, table, and equation labels. |
| Hover Peek and glossary | Preview a figure, table, equation, or reference without turning the page. Hover over a defined acronym such as MHA to see its expansion, the defining sentence, and its source page. |
| Four-way pin dock | Compare several figures at once. Drag the dock to any edge. Current-page **Auto-Sync** suggests cross-page assets cited on that page. Free-snip any region, extend its crop up or down, or reset the original crop in one click. |
| Citation backlinks | A card lists detected mentions in the text. Select a page chip to jump to the exact occurrence, including multiple mentions on the same page. |
| Selectable text and clean copy | Select text directly on the PDF. Clean Copy repairs line breaks and split words. Translate a selection on demand with an OpenAI-compatible API or a local Ollama model. |
| Local reading archive | Recent papers remembers your page, zoom, scroll position, and pins in IndexedDB. Crops are stored as coordinates and regenerated when the paper reopens. |
| Long-document rendering | A shared `IntersectionObserver` tracks nearby pages. Off-screen pages release their canvas buffers and text layers while retaining their place in the layout. |

**The Chrome MV3 companion** works alongside the paper on arXiv, OpenReview, ACL Anthology, IEEE, Nature, Springer, PubMed/PMC, and local PDFs. On article pages it reads the available HTML. For a PDF, the panel can extract assets or capture a region of the visible tab. Optional translation offers original, translation-only, and bilingual views. **EN / 中文** switches the panel, the on-page controls, and the bilingual PDF reader together. The browser provides the language for the toolbar title and native context menus.

## Cross-platform support

| Surface | Platforms and browsers |
| --- | --- |
| Web reader | Windows, macOS, and Linux in modern browsers, including Chrome, Edge, Firefox, and Safari on macOS. |
| Companion extension | Windows, macOS, and Linux with a Chromium-based browser that implements `chrome.sidePanel`. The baseline is Chrome 114+ or Edge 114+. Brave, Arc, and Vivaldi support depends on the browser release and its side-panel implementation. |

On Chromium 114–115, open RefPin from the browser’s side panel. Opening it programmatically from a context menu or a pin action uses an API introduced in Chrome 116. On Safari and Firefox, use the web reader. The extension requires the Chromium side-panel API. [Chrome side panel documentation](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

## Quick start

### Option A · Install the Chrome / Edge extension (no coding required)

Works on **Windows, macOS, and Linux** (Chrome 114+, Edge 114+, Brave, Arc, Vivaldi):

1. Download **`RefPin-Extension-v*.zip`** from [**GitHub Releases**](https://github.com/xxxpixel-x/RefPin/releases/latest) and extract it to a permanent folder.
2. Double-click **`INSTALL-GUIDE.html`** inside for the interactive 3-step visual guide (works offline, auto-detects Windows/macOS/Linux shortcuts, no OS security warnings), **or**:
   - Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
   - Drag the **`RefPin-Extension/`** folder directly onto the Extensions page (or click **Load unpacked** and select it).
3. Pin the RefPin icon to your toolbar and open any paper. For local `file://` PDFs, enable **Allow access to file URLs** in the extension’s details (or drop a PDF straight into the side panel).

| Release archive | Audience |
| --- | --- |
| `RefPin-Extension-v*.zip` | End users on Windows, macOS, and Linux — includes the ready-to-load `RefPin-Extension/` folder and offline bilingual `INSTALL-GUIDE.html`. |
| `RefPin-Store-Package-v*.zip` | Store packaging — clean MV3 archive with `manifest.json` at the root for Chrome Web Store and Microsoft Edge Add-ons submission. |

### Option B · Run the local web reader from source

Use Node.js 20 or later. From the project directory, run:

```sh
npm install
npm run dev
```

Open the local address printed by Vite. Drop a PDF or choose **Attention Is All You Need** to start on page 4. The second sample exercises Chinese two-column typesetting. Sample credits are in the [sample notice](./public/samples/NOTICE.md).

```sh
npm test
npm run build
npm run pack:ext
```

- `npm run build` outputs the production web reader to `dist/`.
- `npm run build:ext` builds the unpacked extension to `dist-ext/`.
- `npm run pack:ext` builds and packages both `release/RefPin-Extension-v*.zip` (end-user cross-platform bundle) and `release/RefPin-Store-Package-v*.zip` (Chrome Web Store / Edge Add-ons bundle).

## Keyboard shortcuts

| Key | Where | Action |
| --- | --- | --- |
| `S` | Web reader | Toggle free-snip mode. Drag and release to pin the selection. |
| `[` | Web reader | Open or close the paper assets drawer. |
| `Enter` | Web reader page field | Jump to the entered page. |
| `Esc` | Web reader | Dismiss a preview or lightbox, or cancel snipping. |
| `Alt` + `S` | Activated HTML paper page | Start a snip on the page. |
| `Enter` / `Esc` | Extension screenshot dialog | Pin the selected region / cancel. |

## Privacy and local-first architecture

The core reader works **100% offline** when served locally. PDF.js, its worker, fonts, character maps, and sample PDFs ship with the project. Parsing, previews, glossary extraction, backlinks, and local archiving all run in the browser. RefPin has no upload server or analytics. Opening an online paper retrieves it from its publisher.

The web archive keeps up to 30 reading records and caches up to five local PDFs of 15 MiB or less each. Larger or evicted files can be reselected to restore their pins and position. Clearing browser site data clears the archive.

Translation is opt-in. In the web reader, only the selection and configured credentials go to your chosen endpoint. An Ollama endpoint on localhost keeps the request on your device. In the extension, requesting page translation sends extracted text in batches. The free channel uses unofficial Microsoft Edge, Google Translate, and MyMemory endpoints on a best-effort basis. Limits and availability vary. Choose **Custom API** and supply a key to use your own provider. Leaving its key empty falls back to the free channel. Settings and keys are stored in this browser profile.

| Extension permission | Purpose |
| --- | --- |
| `sidePanel`, `contextMenus` | Display the companion and offer open-panel and snipping actions. |
| `tabs`, `activeTab` | Follow the active paper, switch the PDF translation view, and capture the visible tab for a requested snip. |
| `storage` | Keep local settings and the interface language, and pass a pending pin to a newly opened panel. |
| `<all_urls>` | Read paper pages across publishers, fetch linked PDFs, and reach the selected translation endpoint. The content script runs on HTTP(S) pages. Local PDF file access has its own browser switch. |

## Project structure

```text
RefPin/
├── src/
│   ├── engine/       # Pure-frontend PDF parsing, citation/glossary/backlink detection, WebP cropping, Vitest suites
│   ├── components/   # Web reader UI (PdfViewer, HoverPeekCard, SelectionToolbar, PinDock, AssetDrawer, LandingView)
│   ├── storage/      # Native IndexedDB local reading archive & bounded PDF blob cache
│   ├── services/     # Decoupled translation service (Web OpenAI-compatible/Ollama + Extension adapters)
│   ├── i18n/         # Shared zero-dependency EN / ZH-CN catalogs and reactive language toggle
│   ├── store/        # Zustand reader state
│   └── extension/    # Chrome MV3 companion (manifest, _locales, background, content, sidepanel, pdfTranslate)
├── scripts/          # Cross-platform build-extension.mjs & pack-extension.mjs (ZIP + offline install guide)
└── .github/workflows/# CI (test + build + build:ext) and tagged Release automation
```

## Roadmap

- [x] **Phase 0 · Foundations & reliability.** Vitest regression suite, GitHub Actions CI, WebP cropping, `AbortSignal` cancellation, pre-transfer PDF fingerprinting, encrypted/scanned PDF handling, and cross-platform Release packaging.
- [x] **Phase 1 · Context-preserving companion.** Bidirectional citation backlinks, selectable `TextLayer` + Clean Copy + opt-in translation, off-screen canvas/textLayer memory release, IndexedDB local archive & Recent Papers, current-page Auto-Sync, full-paper acronym/symbol glossary, Author-Year & superscript citations, and global **EN / 简体中文** web + extension UI.
- [ ] **Phase 2 · Daily-driver reader.** `Algorithm` / `Theorem` / `Section` detection, PDF Outline & `Ctrl+F` search, multi-step jump history (`Alt+←/→`) & reading ruler, Dark / Sepia eye-care themes, and PWA `file_handlers`.
- [ ] **Phase 3 · Research workflow & ecosystem.** One-click Markdown / Obsidian `.zip` study note export, opt-in OpenAlex / Crossref citation enrichment & BibTeX, `Ctrl+K` command palette, and Chrome Web Store / Microsoft Edge Add-ons publishing.

## Contributing

For a missed citation, include its exact text, page number, expected target, and a shareable sample if possible. For an extension issue, include the browser version and whether the paper is HTML, a remote PDF, or a local file. When adding interface text, update both catalogs in `src/i18n/locales/` and run the three checks above. Pull requests are welcome.

## License

RefPin’s source code is released under the [MIT License](./LICENSE). The bundled documents and PDF.js resources retain their respective notices. [Sample attribution](./public/samples/NOTICE.md)
