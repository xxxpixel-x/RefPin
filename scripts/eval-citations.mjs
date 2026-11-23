import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as pdfjs from 'pdfjs-dist';
import { createServer } from 'vite';
import { evalDir, pdfPath, readCorpus, readJson, verifyPdf } from './eval-corpus.mjs';

const channelNames = { native: '原生链接', text: '文本', both: '双通道' };
const { values: { channel } } = parseArgs({ options: { channel: { type: 'string' } } });
if (channel !== undefined && !Object.hasOwn(channelNames, channel)) {
  throw new Error('--channel 支持 native、text、both，省略时输出全部三组');
}
const channels = channel === undefined ? Object.keys(channelNames) : [channel];

function summary(papers, metrics) {
  const scores = {};
  for (const name of channels) {
    const counts = { labeled: 0, predicted: 0, matched: 0, located: 0 };
    for (const { scores } of papers) {
      for (const key of Object.keys(counts)) counts[key] += scores[name][key];
    }
    scores[name] = { ...counts, ...metrics(counts) };
  }
  return { papers: papers.length, labels: scores[channels[0]].labeled, scores };
}

function markdown({ groups, total }) {
  const metricNames = ['精确率', '召回率', '定位正确率'];
  const headers = ['分组', '篇数', '标注引用数', ...channels.flatMap(ch => metricNames.map(m => channelNames[ch] + ' ' + m))];
  const row = cells => '| ' + cells.join(' | ') + ' |';
  const percent = n => n === null ? '—' : (100 * n).toFixed(1) + '%';
  const rows = Object.entries({ ...groups, '合计': total }).map(([group, { papers, labels, scores }]) =>
    row([group, papers, labels, ...channels.flatMap(ch => {
      const { precision, recall, targetAccuracy } = scores[ch];
      return [precision, recall, targetAccuracy].map(percent);
    })]));
  return ['# 引用识别评测', '', '仅统计完整标注页。按引用数汇总，定位正确率的分母为匹配数。分母为零时记为 —。',
    '', row(headers), row(headers.map(() => '---')), ...rows, '',
    '各篇的页码、原始计数、漏检、误检及定位错误见 [JSON 报告](report.json)。语料和复现步骤见 [评测说明](README.md)。', ''].join('\n');
}

// 使用仓库已有的 Vite 加载带 ?url 导入的阅读器 TypeScript 模块。
const vite = await createServer({
  configFile: false, appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { parsePaperCitations } = await vite.ssrLoadModule('/src/engine/parsePaper.ts');
  const { detectCitations } = await vite.ssrLoadModule('/src/engine/citationDetector.ts');
  const { locateLabels, scoreCitations, metrics } = await vite.ssrLoadModule('/eval/scoring.ts');
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');
  const pdfjsDir = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
  const corpus = await readCorpus();
  const papers = [];
  for (const entry of corpus.filter(p => !p.todo)) {
    const { id, group } = entry;
    try {
      const labels = await readJson(join(evalDir, 'labels', id + '.json'));
      const bytes = await readFile(pdfPath(id));
      const sha256 = verifyPdf(entry, bytes);
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes), cMapUrl: join(pdfjsDir, 'cmaps') + sep,
        cMapPacked: true, standardFontDataUrl: join(pdfjsDir, 'standard_fonts') + sep,
        isEvalSupported: false,
      });
      try {
        const doc = await task.promise;
        const { linesByPage, referencesMap, refRange, citationsByPage } = await parsePaperCitations(doc, { channel: channels[0] });
        const located = locateLabels(labels, linesByPage);
        const scores = {};
        for (const name of channels) {
          const predictions = name === channels[0] ? citationsByPage :
            await detectCitations(doc, linesByPage, { referencesMap, refRange, channel: name });
          scores[name] = scoreCitations(labels, located, predictions);
        }
        papers.push({ id, group, sha256, reviewedPages: labels.reviewedPages, scores });
        console.log(`${id}：${labels.reviewedPages.length} 页，${located.length} 处标注`);
      } finally {
        await task.destroy();
      }
    } catch (error) {
      throw new Error(`${id} 评测失败：${error.message}。请核对标注或运行 npm run eval:fetch。`, { cause: error });
    }
  }
  const groups = Object.fromEntries([...new Set(corpus.map(p => p.group))].map(group =>
    [group, summary(papers.filter(p => p.group === group), metrics)]));
  const report = { channels, groups, total: summary(papers, metrics), papers };
  const md = markdown(report);
  await writeFile(join(evalDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(evalDir, 'report.md'), md);
  console.log(md);
} finally {
  await vite.close();
}
