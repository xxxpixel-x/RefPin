import fs from 'node:fs';
import path from 'node:path';
import { renderRefPinIcon } from './refpin-icon.mjs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'dist-ext');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getFolderSizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += getFolderSizeBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

async function run() {
  console.log('\n[RefPin Extension] 1/4 Building Reader, Side Panel and PDF Translate...');
  await build({
    configFile: false,
    root: rootDir,
    base: './',
    publicDir: false,
    plugins: [react()],
    // The standard PDF.js build uses Promise.withResolvers, absent in Chrome 114.
    resolve: {
      alias: [
        { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
        { find: 'pdfjs-dist/build/pdf.worker.min.mjs?url', replacement: 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url' },
      ],
    },
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          reader: path.join(rootDir, 'reader.html'),
          sidepanel: path.join(rootDir, 'sidepanel.html'),
          pdfTranslate: path.join(rootDir, 'pdf-translate.html'),
        },
        output: {
          // Chrome MV3 禁止扩展包内出现下划线开头的文件名（如 __vite-browser-external-*.js）
          sanitizeFileName(name) {
            const cleaned = name
              .replace(/[\0:*?"<>|]/g, '')
              .replace(/^_+/, 'ext-');
            return cleaned || 'chunk';
          },
        },
      },
    },
  });

  console.log('\n[RefPin Extension] 2/4 Building background service worker...');
  await build({
    configFile: false,
    root: rootDir,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: path.join(rootDir, 'src/extension/background.ts'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  console.log('\n[RefPin Extension] 3/4 Building on-page content script...');
  await build({
    configFile: false,
    root: rootDir,
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: path.join(rootDir, 'src/extension/content.ts'),
        name: 'RefPinContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });

  console.log('\n[RefPin Extension] 4/4 Copying manifest, fonts, cmaps & icons...');
  fs.copyFileSync(
    path.join(rootDir, 'src/extension/manifest.json'),
    path.join(outDir, 'manifest.json'),
  );

  // 仅复制 pdf.js 必需的 cmaps 与 standard_fonts，刻意排除 public/samples/
  copyDir(path.join(rootDir, 'src/extension/_locales'), path.join(outDir, '_locales'));
  copyDir(path.join(rootDir, 'public/cmaps'), path.join(outDir, 'cmaps'));
  copyDir(
    path.join(rootDir, 'public/standard_fonts'),
    path.join(outDir, 'standard_fonts'),
  );

  const iconsDir = path.join(outDir, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), renderRefPinIcon(size));
  }

  const sizeMb = (getFolderSizeBytes(outDir) / (1024 * 1024)).toFixed(2);
  console.log(`\n[RefPin Extension] Done! Output: ${outDir} (${sizeMb} MB)`);
  console.log('Load unpacked extension from dist-ext/ in chrome://extensions or edge://extensions.\n');
}

run().catch((err) => {
  console.error('[RefPin Extension] Build failed:', err);
  process.exit(1);
});
