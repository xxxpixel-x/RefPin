import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { copyOcrLicenses } from './copy-ocr-licenses.mjs';

const output = new URL('../dist/', import.meta.url);
copyOcrLicenses(fileURLToPath(output));
const files = [];
const hash = createHash('sha256');
function collect(directory) {
  for (const entry of readdirSync(new URL(directory, output), { withFileTypes: true })) {
    const file = directory + entry.name;
    if (entry.isDirectory()) collect(file + '/');
    else if (/\.(html|js|mjs|css|png|webmanifest|pdf|ttf|pfb|bcmap)$/.test(file) && file !== './sw.js') files.push(file);
  }
}
collect('./');
for (const file of files.sort()) hash.update(file).update(readFileSync(new URL(file, output)));
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const version = hash.update(source).digest('hex').slice(0, 16);
writeFileSync(new URL('sw.js', output), source.replace('DEV_VERSION', version)
  .replace("/* PRECACHE */ ['./index.html']", JSON.stringify(files)));
