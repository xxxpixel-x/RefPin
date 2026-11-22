import { IS_EXTENSION_PAGE } from './runtime';
import { t } from '../i18n/core';
import type { SamplePaperMeta } from '../types/paper';

export const SAMPLES: SamplePaperMeta[] = [
  {
    id: 'attention',
    title: 'Attention Is All You Need',
    get subtitle() { return t('sample.attentionSubtitle'); },
    url: IS_EXTENSION_PAGE ? 'https://arxiv.org/pdf/1706.03762.pdf' : import.meta.env.BASE_URL + 'samples/attention.pdf',
    demoStartPage: 4,
    get badge() { return t(IS_EXTENSION_PAGE ? 'sample.arxivBadge' : 'sample.attentionBadge'); },
  },
  {
    id: 'sample-zh',
    get title() { return t('sample.chineseTitle'); },
    get subtitle() { return t('sample.chineseSubtitle'); },
    url: import.meta.env.BASE_URL + 'samples/sample-zh.pdf',
    demoStartPage: 1,
    get badge() { return t('sample.chineseBadge'); },
  },
].filter(sample => !IS_EXTENSION_PAGE || sample.id !== 'sample-zh');

export function getSampleById(id: string): SamplePaperMeta | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}
