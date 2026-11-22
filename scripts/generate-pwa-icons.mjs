import { mkdirSync, writeFileSync } from 'node:fs';
import { renderRefPinIcon } from './refpin-icon.mjs';

const icons = new URL('../public/icons/', import.meta.url);
mkdirSync(icons, { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(new URL('icon-' + size + '.png', icons), renderRefPinIcon(size));
}
