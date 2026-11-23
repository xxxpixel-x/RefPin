import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const evalDir = fileURLToPath(new URL('../eval/', import.meta.url));
export const pdfDir = join(evalDir, 'pdfs');
export const pdfPath = (id) => join(pdfDir, id + '.pdf');
export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

export async function readCorpus() {
  const papers = await readJson(join(evalDir, 'corpus.json'));
  const ids = new Set();
  for (const paper of papers) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(paper.id) || ids.has(paper.id) ||
        !paper.group || !paper.license || Boolean(paper.url) === (paper.local === true) ||
        (paper.url && !/^[a-f0-9]{64}$/.test(paper.sha256))) {
      throw new Error(`语料条目无效或 id 重复：${paper.id}`);
    }
    ids.add(paper.id);
  }
  return papers;
}

export function verifyPdf(paper, bytes) {
  if (!bytes.subarray(0, 1024).includes('%PDF-')) throw new Error(`${paper.id} 缺少 PDF 文件头`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (paper.sha256 && hash !== paper.sha256) {
    throw new Error(`${paper.id} 的 SHA-256 与语料清单不符，请核对 PDF 版本`);
  }
  return hash;
}
