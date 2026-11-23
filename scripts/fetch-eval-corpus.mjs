import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { pdfDir, pdfPath, readCorpus, verifyPdf } from './eval-corpus.mjs';

async function fetchPaper(paper) {
  const path = pdfPath(paper.id);
  try {
    verifyPdf(paper, await readFile(path));
    console.log(`已缓存 ${paper.id}`);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(paper.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${paper.url} 下载失败，HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyPdf(paper, bytes);
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, bytes, { flag: 'wx' });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  console.log(`已下载 ${paper.id}`);
}

await mkdir(pdfDir, { recursive: true });
for (const paper of await readCorpus()) {
  if (paper.url && !paper.todo) await fetchPaper(paper);
}
