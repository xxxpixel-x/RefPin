import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function copyOcrLicenses(output) {
  const directory = join(output, 'licenses');
  mkdirSync(directory, { recursive: true });
  const license = readFileSync(require.resolve('tesseract.js-core/LICENSE'), 'utf8');
  const notices = readFileSync(require.resolve('tesseract.js/dist/worker.min.js.LICENSE.txt'), 'utf8');
  writeFileSync(join(directory, 'tesseract.txt'),
    'Tesseract.js, Tesseract.js-core, tessdata_fast\n\n' + license + '\n' + notices);
}
