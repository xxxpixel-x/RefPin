import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distExtDir = path.join(rootDir, 'dist-ext');
const releaseDir = path.join(rootDir, 'release');

// ---- Pure Node ZIP writer (UTF-8 + Deflate, Win / macOS / Linux compatible) ----

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Create a standard ZIP buffer from `{ name, data, mtime? }` entries.
 * Uses POSIX forward slashes, UTF-8 general-purpose flag (0x0800), and raw deflate.
 */
function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const namePosix = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(namePosix, 'utf8');
    const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(rawData);
    const deflated = zlib.deflateRawSync(rawData, { level: 9 });
    const useDeflate = deflated.length < rawData.length;
    const body = useDeflate ? deflated : rawData;
    const method = useDeflate ? 8 : 0;
    const { dosTime, dosDate } = toDosTimeDate(entry.mtime ?? new Date());
    const utf8Flag = 0x0800;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central file header signature
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix + 2.0
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attrs
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: rw-r--r--
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + body.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function collectFiles(dir, prefix = '') {
  const results = [];
  const names = fs.readdirSync(dir).sort();
  for (const name of names) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, rel));
    } else if (stat.isFile()) {
      results.push({
        name: rel,
        data: fs.readFileSync(full),
        mtime: stat.mtime,
      });
    }
  }
  return results;
}

// ---- Self-contained offline bilingual 3-step install guide (Win / macOS / Linux) ----

function buildInstallGuideHtml(version) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RefPin v${version} — 3-Step Install Guide / 3步安装向导</title>
  <style>
    :root {
      --bg: #F7F6F3;
      --paper: #FFFFFF;
      --border: #E7E5E4;
      --ink: #1C1917;
      --muted: #78716C;
      --gold: #D97706;
      --gold-bg: #FEF3C7;
      --gold-soft: #FFFBEB;
      --gold-text: #92400E;
      --ok: #15803D;
      --ok-bg: #DCFCE7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    .wrap {
      max-width: 780px;
      margin: 0 auto;
      padding: 36px 20px 64px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--ink);
      color: #fff;
      display: grid;
      place-items: center;
      font-weight: 700;
      font-size: 20px;
      position: relative;
      flex-shrink: 0;
    }
    .logo::after {
      content: "";
      position: absolute;
      top: 5px;
      right: 5px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--gold);
      border: 2px solid var(--bg);
    }
    .brand h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
      letter-spacing: -0.01em;
    }
    .brand p {
      margin: 2px 0 0;
      font-size: 13px;
      color: var(--muted);
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .seg {
      display: inline-flex;
      background: var(--paper);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 3px;
      gap: 2px;
    }
    .seg button {
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
      padding: 5px 10px;
      border-radius: 7px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .seg button.active {
      background: var(--ink);
      color: #fff;
    }
    .banner {
      background: var(--gold-soft);
      border: 1px solid #FDE68A;
      border-radius: 14px;
      padding: 14px 18px;
      margin-bottom: 22px;
      font-size: 13.5px;
      color: var(--gold-text);
    }
    .banner strong { color: var(--ink); }
    .step {
      background: var(--paper);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px 22px;
      margin-bottom: 16px;
      box-shadow: 0 1px 2px rgba(28, 25, 23, 0.04);
    }
    .step-head {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }
    .badge {
      width: 28px;
      height: 28px;
      border-radius: 999px;
      background: var(--gold-bg);
      color: var(--gold-text);
      font-weight: 700;
      font-size: 14px;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .step h2 {
      margin: 0;
      font-size: 16.5px;
      font-weight: 600;
    }
    .step p {
      margin: 6px 0 12px;
      font-size: 14px;
      color: #44403C;
    }
    .url-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      margin: 12px 0;
    }
    .url-card {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: #FAFAF9;
    }
    .url-card .meta {
      min-width: 0;
    }
    .url-card .browser {
      font-size: 12px;
      font-weight: 600;
      color: var(--ink);
    }
    .url-card code {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--gold-text);
      margin-top: 2px;
      word-break: break-all;
    }
    .copy-btn {
      border: 1px solid var(--border);
      background: var(--paper);
      color: var(--ink);
      border-radius: 8px;
      padding: 6px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
    }
    .copy-btn:hover {
      border-color: var(--gold);
      color: var(--gold-text);
      background: var(--gold-soft);
    }
    .copy-btn.copied {
      border-color: #86EFAC;
      background: var(--ok-bg);
      color: var(--ok);
    }
    .kbd-row {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
      color: var(--muted);
      background: #FAFAF9;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 10px;
      margin-top: 4px;
      flex-wrap: wrap;
    }
    kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11.5px;
      background: #fff;
      border: 1px solid #D6D3D1;
      border-bottom-width: 2px;
      border-radius: 5px;
      padding: 1px 6px;
      color: var(--ink);
    }
    .diagram {
      margin-top: 12px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: #FAFAF9;
      padding: 14px;
      overflow-x: auto;
    }
    .diagram svg {
      display: block;
      width: 100%;
      max-width: 680px;
      height: auto;
      margin: 0 auto;
    }
    .folder-pill {
      display: inline-block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
      font-weight: 600;
      background: var(--gold-bg);
      color: var(--gold-text);
      padding: 2px 8px;
      border-radius: 6px;
    }
    .tips {
      background: var(--paper);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 22px;
      margin-top: 20px;
    }
    .tips h3 {
      margin: 0 0 10px;
      font-size: 15px;
    }
    .tips ul {
      margin: 0;
      padding-left: 18px;
      font-size: 13.5px;
      color: #44403C;
    }
    .tips li { margin-bottom: 8px; }
    .footer {
      text-align: center;
      margin-top: 28px;
      font-size: 12px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="brand">
        <div class="logo">R</div>
        <div>
          <h1 data-i18n="title">RefPin 浮页 · 3 步安装向导</h1>
          <p data-i18n="subtitle">v${version} · 无需编程 · 适用于 Windows / macOS / Linux</p>
        </div>
      </div>
      <div class="controls">
        <div class="seg" role="group" aria-label="OS">
          <button type="button" data-os="win">Windows</button>
          <button type="button" data-os="mac">macOS</button>
          <button type="button" data-os="linux">Linux</button>
        </div>
        <div class="seg" role="group" aria-label="Language">
          <button type="button" data-lang="zh-CN">中文</button>
          <button type="button" data-lang="en">EN</button>
        </div>
      </div>
    </header>

    <div class="banner" data-i18n-html="banner">
      <strong>重要提示：</strong>请先将压缩包<strong>完整解压</strong>到一个不会误删的文件夹（例如「文档」目录），再按下面 3 步操作。安装完成后请不要删除 <span class="folder-pill">RefPin-Extension</span> 文件夹。
    </div>

    <section class="step">
      <div class="step-head">
        <div class="badge">1</div>
        <h2 data-i18n="step1Title">打开浏览器的「扩展程序」页面</h2>
      </div>
      <p data-i18n="step1Desc">浏览器出于安全限制不允许网页直接跳转设置页。点击下方按钮复制地址，然后粘贴到浏览器地址栏并按回车：</p>
      <div class="url-grid">
        <div class="url-card">
          <div class="meta">
            <div class="browser">Google Chrome</div>
            <code>chrome://extensions</code>
          </div>
          <button type="button" class="copy-btn" data-copy="chrome://extensions" data-i18n="copy">复制</button>
        </div>
        <div class="url-card">
          <div class="meta">
            <div class="browser">Microsoft Edge</div>
            <code>edge://extensions</code>
          </div>
          <button type="button" class="copy-btn" data-copy="edge://extensions" data-i18n="copy">复制</button>
        </div>
        <div class="url-card">
          <div class="meta">
            <div class="browser">Brave / Arc / Vivaldi</div>
            <code>chrome://extensions</code>
          </div>
          <button type="button" class="copy-btn" data-copy="chrome://extensions" data-i18n="copy">复制</button>
        </div>
      </div>
      <div class="kbd-row" id="shortcutHint"></div>
    </section>

    <section class="step">
      <div class="step-head">
        <div class="badge">2</div>
        <h2 data-i18n="step2Title">打开「开发者模式」开关</h2>
      </div>
      <p data-i18n="step2Desc">在扩展程序页面右上角（Edge 在左下角或左侧栏）找到「开发者模式 / Developer mode」，把开关点亮变成蓝色。</p>
      <div class="diagram">
        <svg viewBox="0 0 640 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="1" y="1" width="638" height="118" rx="12" fill="#FFFFFF" stroke="#E7E5E4" stroke-width="2"/>
          <rect x="2" y="2" width="636" height="44" rx="10" fill="#F7F6F3"/>
          <circle cx="24" cy="24" r="5" fill="#D6D3D1"/>
          <circle cx="42" cy="24" r="5" fill="#D6D3D1"/>
          <circle cx="60" cy="24" r="5" fill="#D6D3D1"/>
          <rect x="92" y="12" width="240" height="24" rx="6" fill="#FFFFFF" stroke="#E7E5E4"/>
          <text x="104" y="28" fill="#78716C" font-size="12" font-family="monospace">chrome://extensions</text>
          <text x="412" y="29" fill="#1C1917" font-size="13" font-weight="600" id="svgDevLabel">Developer mode</text>
          <rect x="540" y="14" width="44" height="22" rx="11" fill="#D97706"/>
          <circle cx="573" cy="25" r="8" fill="#FFFFFF"/>
          <rect x="24" y="64" width="146" height="32" rx="8" fill="#FEF3C7" stroke="#F59E0B" stroke-width="1.5"/>
          <text x="40" y="84" fill="#92400E" font-size="12.5" font-weight="600" id="svgLoadLabel">Load unpacked</text>
          <rect x="184" y="64" width="116" height="32" rx="8" fill="#F5F5F4" stroke="#E7E5E4"/>
          <rect x="314" y="64" width="90" height="32" rx="8" fill="#F5F5F4" stroke="#E7E5E4"/>
        </svg>
      </div>
    </section>

    <section class="step">
      <div class="step-head">
        <div class="badge">3</div>
        <h2 data-i18n="step3Title">把 RefPin-Extension 文件夹拖进浏览器（或点击加载）</h2>
      </div>
      <p data-i18n-html="step3Desc">
        回到刚解压的目录，找到同级的 <span class="folder-pill">RefPin-Extension</span> 文件夹，<strong>直接用鼠标把它拖进刚才打开的扩展页面窗口</strong>并松手即可！<br/>
        也可以点击页面上的「加载已解压的扩展程序 / Load unpacked」，然后选中 <span class="folder-pill">RefPin-Extension</span> 文件夹。
      </p>
      <div class="diagram">
        <svg viewBox="0 0 640 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="16" y="22" width="190" height="86" rx="12" fill="#FEF3C7" stroke="#D97706" stroke-width="2"/>
          <path d="M36 42h44l10 10h86a8 8 0 0 1 8 8v30a8 8 0 0 1-8 8H36a8 8 0 0 1-8-8V50a8 8 0 0 1 8-8Z" fill="#FFFBEB" stroke="#D97706" stroke-width="1.6"/>
          <text x="42" y="79" fill="#92400E" font-size="13" font-weight="700" font-family="monospace">RefPin-Extension</text>
          <path d="M226 65h112" stroke="#D97706" stroke-width="2.5" stroke-dasharray="6 5"/>
          <path d="M332 57l12 8-12 8" stroke="#D97706" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="364" y="16" width="258" height="98" rx="12" fill="#FFFFFF" stroke="#1C1917" stroke-width="2" stroke-dasharray="6 4"/>
          <text x="493" y="60" text-anchor="middle" fill="#1C1917" font-size="14" font-weight="700" id="svgDropTitle">Drop onto Extensions page</text>
          <text x="493" y="84" text-anchor="middle" fill="#78716C" font-size="12" id="svgDropSub">chrome://extensions</text>
        </svg>
      </div>
    </section>

    <section class="tips">
      <h3 data-i18n="tipsTitle">装好之后的小贴士</h3>
      <ul>
        <li data-i18n-html="tip1"><strong>固定图标：</strong>点浏览器右上角拼图图标，把 <strong>RefPin</strong> 旁的图钉点亮，以后读论文（arXiv / OpenReview / Nature / IEEE / PDF）点一下图标就能打开右侧伴读栏。</li>
        <li data-i18n-html="tip2"><strong>阅读本地 PDF：</strong>在扩展页面找到 RefPin 点「详细信息 / Details」，打开<strong>「允许访问文件网址 / Allow access to file URLs」</strong>，就能直接伴读电脑里的本地 PDF（或者直接把 PDF 拖进侧边栏）。</li>
        <li data-i18n-html="tip3"><strong>切换中英文：</strong>侧边栏右上角随时可点 <strong>EN / 中文</strong> 一键切换界面语言。</li>
        <li data-i18n-html="tip4"><strong>Safari / Firefox 用户：</strong>本插件依赖 Chromium 的侧边栏接口（Chrome 114+ / Edge 114+）；Safari 和 Firefox 请直接使用 RefPin 网页版。</li>
      </ul>
    </section>

    <footer class="footer">
      RefPin v${version} · 100% Local-First · MIT License · github.com/xxxpixel-x/RefPin
    </footer>
  </div>

  <script>
    const DICT = {
      'zh-CN': {
        title: 'RefPin 浮页 · 3 步安装向导',
        subtitle: 'v${version} · 无需编程 · 适用于 Windows / macOS / Linux',
        banner: '<strong>重要提示：</strong>请先将压缩包<strong>完整解压</strong>到一个不会误删的文件夹（例如「文档」目录），再按下面 3 步操作。安装完成后请不要删除 <span class="folder-pill">RefPin-Extension</span> 文件夹。',
        step1Title: '打开浏览器的「扩展程序」页面',
        step1Desc: '浏览器出于安全限制不允许网页直接跳转设置页。点击下方按钮复制地址，然后粘贴到浏览器地址栏并按回车：',
        copy: '复制地址',
        copied: '已复制 ✓',
        step2Title: '打开「开发者模式」开关',
        step2Desc: '在扩展程序页面右上角（Edge 在左侧栏）找到「开发者模式 / Developer mode」，把开关点亮。',
        step3Title: '把 RefPin-Extension 文件夹拖进浏览器（或点击加载）',
        step3Desc: '回到刚解压的目录，找到同级的 <span class="folder-pill">RefPin-Extension</span> 文件夹，<strong>直接用鼠标把它拖进刚才打开的扩展页面窗口</strong>松手即可！<br/>也可以点击页面左上角「加载已解压的扩展程序 / Load unpacked」，然后选中 <span class="folder-pill">RefPin-Extension</span> 文件夹。',
        tipsTitle: '装好之后的小贴士',
        tip1: '<strong>固定图标：</strong>点浏览器右上角拼图图标，把 <strong>RefPin</strong> 旁的图钉点亮，以后打开论文（arXiv / OpenReview / Nature / IEEE / PDF）点一下图标就能展开伴读侧边栏。',
        tip2: '<strong>阅读本地 PDF：</strong>在扩展页面找到 RefPin 点「详细信息」，打开<strong>「允许访问文件网址」</strong>，就能直接伴读电脑里的本地 PDF（也可直接把 PDF 拖进侧边栏）。',
        tip3: '<strong>中英切换：</strong>侧边栏右上角随时可点 <strong>EN / 中文</strong> 切换界面语言。',
        tip4: '<strong>支持范围：</strong>适用于 Windows / macOS / Linux 上的 Chrome 114+、Edge 114+、Brave、Arc、Vivaldi 等 Chromium 浏览器。Safari / Firefox 请使用网页版。',
        shortcutPrefix: '快捷操作：新开标签页后按',
        shortcutMid: '粘贴后按',
        svgDev: '开发者模式',
        svgLoad: '加载已解压的扩展程序',
        svgDropTitle: '拖进扩展程序页面松手即装好',
        svgDropSub: 'chrome://extensions 或 edge://extensions',
      },
      en: {
        title: 'RefPin — 3-Step Extension Install Guide',
        subtitle: 'v${version} · No coding required · Works on Windows, macOS & Linux',
        banner: '<strong>Before you start:</strong> Extract the entire ZIP archive to a folder you will keep (such as Documents). Do not delete the <span class="folder-pill">RefPin-Extension</span> folder after installing.',
        step1Title: 'Open your browser’s Extensions page',
        step1Desc: 'Browsers block direct links to internal settings pages. Click Copy below, paste the address into your browser’s address bar, and press Enter:',
        copy: 'Copy URL',
        copied: 'Copied ✓',
        step2Title: 'Turn on Developer mode',
        step2Desc: 'Find the "Developer mode" toggle at the top-right of the Extensions page (or in the left sidebar in Edge) and switch it ON.',
        step3Title: 'Drag the RefPin-Extension folder into the browser',
        step3Desc: 'In the extracted folder, locate <span class="folder-pill">RefPin-Extension</span> next to this guide and <strong>drag and drop it straight onto the Extensions page</strong>!<br/>Alternatively, click <strong>Load unpacked</strong> and select the <span class="folder-pill">RefPin-Extension</span> folder.',
        tipsTitle: 'Quick tips after installing',
        tip1: '<strong>Pin the icon:</strong> Click the puzzle piece icon in your browser toolbar and pin <strong>RefPin</strong> so you can open the companion side panel on any paper with one click.',
        tip2: '<strong>Local PDF files:</strong> Click <strong>Details</strong> on the RefPin card and enable <strong>Allow access to file URLs</strong> to read local PDFs directly (or drop any PDF into the side panel).',
        tip3: '<strong>Switch language:</strong> Toggle <strong>EN / 中文</strong> anytime in the side panel header.',
        tip4: '<strong>Supported browsers:</strong> Chrome 114+, Edge 114+, Brave, Arc, and Vivaldi on Windows, macOS, and Linux. Safari and Firefox users can use the RefPin web reader.',
        shortcutPrefix: 'Shortcut: open a new tab, press',
        shortcutMid: 'then paste with',
        svgDev: 'Developer mode',
        svgLoad: 'Load unpacked',
        svgDropTitle: 'Drop onto Extensions page',
        svgDropSub: 'chrome://extensions or edge://extensions',
      },
    };

    function detectOs() {
      const p = (navigator.platform || navigator.userAgent || '').toLowerCase();
      if (p.includes('mac')) return 'mac';
      if (p.includes('linux')) return 'linux';
      return 'win';
    }

    let currentOs = detectOs();
    let currentLang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';

    function render() {
      const d = DICT[currentLang];
      document.documentElement.lang = currentLang;
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (d[key]) el.textContent = d[key];
      });
      document.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.getAttribute('data-i18n-html');
        if (d[key]) el.innerHTML = d[key];
      });
      document.getElementById('svgDevLabel').textContent = d.svgDev;
      document.getElementById('svgLoadLabel').textContent = d.svgLoad;
      document.getElementById('svgDropTitle').textContent = d.svgDropTitle;
      document.getElementById('svgDropSub').textContent = d.svgDropSub;

      const mod = currentOs === 'mac' ? '⌘' : 'Ctrl';
      const enter = currentOs === 'mac' ? 'Return' : 'Enter';
      const hint = document.getElementById('shortcutHint');
      hint.innerHTML =
        currentLang === 'zh-CN'
          ? d.shortcutPrefix + ' <kbd>' + mod + '</kbd>+<kbd>L</kbd>，按 <kbd>' + mod + '</kbd>+<kbd>V</kbd> ' + d.shortcutMid + ' <kbd>' + enter + '</kbd>'
          : d.shortcutPrefix + ' <kbd>' + mod + '</kbd>+<kbd>L</kbd>, ' + d.shortcutMid + ' <kbd>' + mod + '</kbd>+<kbd>V</kbd> + <kbd>' + enter + '</kbd>';

      document.querySelectorAll('[data-os]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-os') === currentOs);
      });
      document.querySelectorAll('[data-lang]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-lang') === currentLang);
      });
    }

    document.querySelectorAll('[data-os]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentOs = btn.getAttribute('data-os');
        render();
      });
    });

    document.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentLang = btn.getAttribute('data-lang');
        render();
      });
    });

    document.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const text = btn.getAttribute('data-copy');
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        const d = DICT[currentLang];
        btn.textContent = d.copied;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = DICT[currentLang].copy;
          btn.classList.remove('copied');
        }, 1800);
      });
    });

    render();
  </script>
</body>
</html>
`;
}

function run() {
  if (!fs.existsSync(path.join(distExtDir, 'manifest.json'))) {
    console.error('[RefPin Pack] dist-ext/manifest.json not found. Run `npm run build:ext` first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(distExtDir, 'manifest.json'), 'utf8'));
  const version = manifest.version || '0.2.0';
  fs.mkdirSync(releaseDir, { recursive: true });

  const distFiles = collectFiles(distExtDir);
  const now = new Date();

  // 1) Cross-platform end-user bundle (Windows / macOS / Linux) with offline visual guide
  const rootFolder = `RefPin-Extension-v${version}`;
  const userEntries = [
    {
      name: `${rootFolder}/INSTALL-GUIDE.html`,
      data: Buffer.from(buildInstallGuideHtml(version), 'utf8'),
      mtime: now,
    },
    ...distFiles.map((f) => ({
      name: `${rootFolder}/RefPin-Extension/${f.name}`,
      data: f.data,
      mtime: f.mtime,
    })),
  ];

  const userZipPath = path.join(releaseDir, `RefPin-Extension-v${version}.zip`);
  const userZip = createZipBuffer(userEntries);
  fs.writeFileSync(userZipPath, userZip);

  // 2) Clean store submission bundle (manifest.json at ZIP root for Chrome Web Store / Edge Add-ons)
  const storeZipPath = path.join(releaseDir, `RefPin-Store-Package-v${version}.zip`);
  const storeZip = createZipBuffer(distFiles);
  fs.writeFileSync(storeZipPath, storeZip);

  const fmtMb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  console.log(`\n[RefPin Pack] Extension v${version} packaged successfully:`);
  console.log(`  1) End-user bundle (Win / macOS / Linux): ${userZipPath} (${fmtMb(userZip.length)})`);
  console.log(`  2) Store submission ZIP (Chrome / Edge):  ${storeZipPath} (${fmtMb(storeZip.length)})\n`);
}

run();
