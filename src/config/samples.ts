import type { SamplePaperMeta } from '../types/paper';

/**
 * 示例论文配置。
 * 第二个中文示例按需补充：把任意中文论文放到 public/samples/sample-zh.pdf 即可。
 */
export const SAMPLES: SamplePaperMeta[] = [
  {
    id: 'attention',
    title: 'Attention Is All You Need',
    subtitle: 'Vaswani et al. · NeurIPS 2017',
    url: '/samples/attention.pdf',
    demoStartPage: 4,
    badge: '推荐体验 · 直达多图引用页',
  },
  {
    id: 'sample-zh',
    title: '中文论文样张',
    subtitle: '双栏排版 · 图 / 表 / 公式 / 参考文献',
    url: '/samples/sample-zh.pdf',
    demoStartPage: 1,
    badge: '中文兼容性验证',
  },
];

export function getSampleById(id: string): SamplePaperMeta | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}
