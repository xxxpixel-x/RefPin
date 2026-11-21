/**
 * B 线独立开发用的 Mock 数据。
 * 全部字段严格遵循 src/types/paper.ts 契约，A 的真实引擎接入后可无缝替换。
 */
import type {
  InlineCitation,
  PaperAsset,
  PinnedItem,
  ReadingStats,
  ReferenceEntry,
} from '../types/paper';

/** 把 SVG 片段转成可直接用于 <img src> 的 dataURL */
function svgUrl(width: number, height: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const FONT = `font-family="Inter, PingFang SC, Microsoft YaHei, sans-serif"`;

const FIGURE_1 = svgUrl(
  880,
  520,
  `
  <text x="34" y="42" ${FONT} font-size="20" font-weight="600" fill="#1C1917">Transformer 架构</text>
  <rect x="150" y="70" width="130" height="46" rx="10" fill="#FFFBEB" stroke="#FDE68A"/>
  <text x="215" y="99" ${FONT} font-size="14" fill="#B45309" text-anchor="middle">Input Embedding</text>
  <rect x="150" y="132" width="130" height="46" rx="10" fill="#F7F6F3" stroke="#E7E5E4"/>
  <text x="215" y="161" ${FONT} font-size="14" fill="#1C1917" text-anchor="middle">Positional Encoding</text>
  ${[0, 1, 2]
    .map(
      (i) => `
  <rect x="330" y="${70 + i * 62}" width="190" height="46" rx="10" fill="#FFFFFF" stroke="#D97706" stroke-opacity="0.45"/>
  <text x="425" y="${99 + i * 62}" ${FONT} font-size="14" fill="#1C1917" text-anchor="middle">Multi-Head Attention ${i + 1}</text>
  <line x1="280" y1="${93 + i * 62}" x2="330" y2="${93 + i * 62}" stroke="#A8A29E" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    )
    .join('')}
  <rect x="330" y="256" width="190" height="46" rx="10" fill="#FEF3C7" stroke="#FDE68A"/>
  <text x="425" y="285" ${FONT} font-size="14" fill="#B45309" text-anchor="middle">Add &amp; Norm</text>
  <rect x="580" y="132" width="150" height="46" rx="10" fill="#F7F6F3" stroke="#E7E5E4"/>
  <text x="655" y="161" ${FONT} font-size="14" fill="#1C1917" text-anchor="middle">Feed Forward</text>
  <line x1="520" y1="155" x2="580" y2="155" stroke="#A8A29E" stroke-width="1.5" marker-end="url(#arrow)"/>
  <line x1="655" y1="178" x2="655" y2="256" stroke="#A8A29E" stroke-width="1.5"/>
  <line x1="520" y1="279" x2="655" y2="279" stroke="#A8A29E" stroke-width="1.5"/>
  <text x="34" y="470" ${FONT} font-size="12" fill="#78716C">每个子层都包着残差连接，这也是正文反复引用本图的原因。</text>
  <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#A8A29E"/></marker></defs>
`,
);

const FIGURE_2 = svgUrl(
  880,
  470,
  `
  <text x="34" y="38" ${FONT} font-size="18" font-weight="600" fill="#1C1917">Attention 权重热力图（8 个头）</text>
  ${Array.from({ length: 8 })
    .map((_, row) =>
      Array.from({ length: 10 })
        .map((__, col) => {
          const opacity = (Math.sin(row * 1.3 + col * 0.9) + 1.6) / 3.2;
          return `<rect x="${44 + col * 78}" y="${64 + row * 44}" width="72" height="38" rx="4" fill="#D97706" fill-opacity="${opacity.toFixed(2)}"/>`;
        })
        .join(''),
    )
    .join('')}
  <text x="44" y="446" ${FONT} font-size="12" fill="#78716C">横轴：目标词位置 · 纵轴：8 个注意力头</text>
`,
);

const TABLE_1 = svgUrl(
  880,
  330,
  `
  <text x="34" y="36" ${FONT} font-size="17" font-weight="600" fill="#1C1917">Table 1 · 不同模型在 WMT14 上的 BLEU</text>
  <rect x="34" y="56" width="812" height="240" rx="8" fill="#FFFFFF" stroke="#E7E5E4"/>
  ${[0, 1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<line x1="34" y1="${96 + i * 40}" x2="846" y2="${96 + i * 40}" stroke="#E7E5E4"/>`,
    )
    .join('')}
  <line x1="260" y1="56" x2="260" y2="296" stroke="#E7E5E4"/>
  <line x1="520" y1="56" x2="520" y2="296" stroke="#E7E5E4"/>
  <line x1="700" y1="56" x2="700" y2="296" stroke="#E7E5E4"/>
  ${['Model', 'BLEU EN-DE', 'BLEU EN-FR', 'Params']
    .map(
      (t, i) =>
        `<text x="${[58, 290, 550, 730][i]}" y="82" ${FONT} font-size="13" font-weight="600" fill="#1C1917">${t}</text>`,
    )
    .join('')}
  ${[
    ['Transformer (base)', '27.3', '38.1', '65M'],
    ['Transformer (big)', '28.4', '41.8', '213M'],
    ['ConvS2S', '25.2', '40.5', '235M'],
    ['ByteNet', '23.8', '—', '—'],
    ['GNMT + RL', '24.6', '39.9', '300M'],
  ]
    .map((row, i) =>
      row
        .map(
          (cell, col) =>
            `<text x="${[58, 290, 550, 730][col]}" y="${122 + i * 40}" ${FONT} font-size="13" fill="${col === 0 ? '#1C1917' : '#78716C'}">${cell}</text>`,
        )
        .join(''),
    )
    .join('')}
`,
);

const EQUATION_1 = svgUrl(
  880,
  150,
  `
  <text x="34" y="62" ${FONT} font-size="18" fill="#1C1917">Attention(Q, K, V) = softmax(QK<tspan baseline-shift="super" font-size="12">T</tspan> / √d<tspan baseline-shift="sub" font-size="12">k</tspan>) · V</text>
  <text x="840" y="62" ${FONT} font-size="15" fill="#78716C" text-anchor="end">(1)</text>
  <text x="34" y="110" ${FONT} font-size="12" fill="#78716C">缩放点积注意力：除以 √dk 防止内积过大导致梯度消失。</text>
`,
);

export const MOCK_ASSETS: PaperAsset[] = [
  {
    key: 'fig-1',
    kind: 'figure',
    label: 'Figure 1',
    caption:
      'The Transformer model architecture. Encoder 与 Decoder 都由堆叠的 Multi-Head Attention 与 Feed Forward 子层组成，每个子层外都包裹残差连接与 LayerNorm。',
    pageNumber: 4,
    cropRect: { x: 0.08, y: 0.14, width: 0.84, height: 0.42 },
    imageUrl: FIGURE_1,
  },
  {
    key: 'fig-2',
    kind: 'figure',
    label: 'Figure 2',
    caption:
      'Attention distributions of 8 heads. 横轴是目标词位置，纵轴是不同注意力头，可以看到不同头关注的语言学结构差异。',
    pageNumber: 5,
    cropRect: { x: 0.06, y: 0.18, width: 0.88, height: 0.36 },
    imageUrl: FIGURE_2,
  },
  {
    key: 'tab-1',
    kind: 'table',
    label: 'Table 1',
    caption:
      'BLEU scores on WMT14 English-to-German / English-to-French translation. Transformer (big) 以更少训练成本取得当时最优结果。',
    pageNumber: 4,
    cropRect: { x: 0.08, y: 0.6, width: 0.84, height: 0.28 },
    imageUrl: TABLE_1,
  },
  {
    key: 'eq-1',
    kind: 'equation',
    label: 'Eq. (1)',
    caption: '缩放点积注意力公式，是全文所有注意力变体的基础。',
    pageNumber: 4,
    cropRect: { x: 0.1, y: 0.88, width: 0.8, height: 0.08 },
    imageUrl: EQUATION_1,
  },
];

export const MOCK_REFERENCES: ReferenceEntry[] = [
  {
    key: 'ref-3',
    index: 3,
    rawText:
      'Sutskever, I., Vinyals, O., and Le, Q. V. Sequence to sequence learning with neural networks. In NIPS, 2014.',
    title: 'Sequence to Sequence Learning with Neural Networks',
    authors: 'Sutskever, Vinyals, Le',
    year: '2014',
    pageNumber: 9,
  },
  {
    key: 'ref-4',
    index: 4,
    rawText:
      'Bahdanau, D., Cho, K., and Bengio, Y. Neural machine translation by jointly learning to align and translate. ICLR, 2015.',
    title: 'Neural Machine Translation by Jointly Learning to Align and Translate',
    authors: 'Bahdanau, Cho, Bengio',
    year: '2015',
    pageNumber: 9,
  },
  {
    key: 'ref-5',
    index: 5,
    rawText:
      'Cho, K., Van Merriënboer, B., Gulcehre, C., et al. Learning phrase representations using RNN encoder-decoder for statistical machine translation. EMNLP, 2014.',
    title: 'Learning Phrase Representations using RNN Encoder-Decoder',
    authors: 'Cho et al.',
    year: '2014',
    pageNumber: 9,
  },
  {
    key: 'ref-12',
    index: 12,
    rawText:
      'He, K., Zhang, X., Ren, S., and Sun, J. Deep residual learning for image recognition. CVPR, 2016.',
    title: 'Deep Residual Learning for Image Recognition',
    authors: 'He, Zhang, Ren, Sun',
    year: '2016',
    pageNumber: 10,
  },
  {
    key: 'ref-14',
    index: 14,
    rawText:
      'Vaswani, A., Shazeer, N., Parmar, N., et al. Attention is all you need. In NIPS, 2017.',
    title: 'Attention Is All You Need',
    authors: 'Vaswani et al.',
    year: '2017',
    pageNumber: 10,
  },
  {
    key: 'ref-15',
    index: 15,
    rawText:
      'Gehring, J., Auli, M., Grangier, D., and Dauphin, Y. Convolutional sequence to sequence learning. ICML, 2017.',
    title: 'Convolutional Sequence to Sequence Learning',
    authors: 'Gehring et al.',
    year: '2017',
    pageNumber: 10,
  },
];

export const MOCK_CITATIONS: Record<number, InlineCitation[]> = {
  4: [
    {
      id: 'p4-c1',
      kind: 'figure',
      rawText: 'Figure 1',
      targetKeys: ['fig-1'],
      pageNumber: 4,
      rect: { x: 0.2, y: 0.3, width: 0.11, height: 0.018 },
      lineY: 0.3,
    },
    {
      id: 'p4-c2',
      kind: 'table',
      rawText: 'Table 1',
      targetKeys: ['tab-1'],
      pageNumber: 4,
      rect: { x: 0.62, y: 0.42, width: 0.09, height: 0.018 },
      lineY: 0.42,
    },
    {
      id: 'p4-c3',
      kind: 'equation',
      rawText: 'Eq. (1)',
      targetKeys: ['eq-1'],
      pageNumber: 4,
      rect: { x: 0.36, y: 0.52, width: 0.09, height: 0.018 },
      lineY: 0.52,
    },
    {
      id: 'p4-c4',
      kind: 'reference',
      rawText: '[14]',
      targetKeys: ['ref-14'],
      pageNumber: 4,
      rect: { x: 0.71, y: 0.63, width: 0.04, height: 0.018 },
      lineY: 0.63,
    },
    {
      id: 'p4-c5',
      kind: 'reference',
      rawText: '[12, 15]',
      targetKeys: ['ref-12', 'ref-15'],
      pageNumber: 4,
      rect: { x: 0.24, y: 0.74, width: 0.08, height: 0.018 },
      lineY: 0.74,
    },
  ],
  5: [
    {
      id: 'p5-c1',
      kind: 'figure',
      rawText: 'Figure 2',
      targetKeys: ['fig-2'],
      pageNumber: 5,
      rect: { x: 0.55, y: 0.27, width: 0.11, height: 0.018 },
      lineY: 0.27,
    },
    {
      id: 'p5-c2',
      kind: 'reference',
      rawText: '[3-5]',
      targetKeys: ['ref-3', 'ref-4', 'ref-5'],
      pageNumber: 5,
      rect: { x: 0.3, y: 0.44, width: 0.055, height: 0.018 },
      lineY: 0.44,
    },
  ],
};

export const MOCK_PINNED: PinnedItem[] = [
  {
    id: 'fig-2',
    kind: 'figure',
    title: 'Figure 2',
    subtitle: MOCK_ASSETS[1].caption,
    pageNumber: 5,
    imageUrl: FIGURE_2,
    cropRect: MOCK_ASSETS[1].cropRect,
    createdAt: Date.now() - 60_000,
  },
  {
    id: 'ref-14',
    kind: 'reference',
    title: 'Attention Is All You Need',
    subtitle: 'Vaswani et al.',
    pageNumber: 10,
    reference: MOCK_REFERENCES[4],
    createdAt: Date.now() - 30_000,
  },
];

export const MOCK_STATS: ReadingStats = {
  savedFlips: 12,
  savedScrollPx: 9600,
  peekCount: 18,
  pinCount: 2,
};

export function mockAssetByKey(key: string): PaperAsset | undefined {
  return MOCK_ASSETS.find((asset) => asset.key === key);
}

export function mockReferenceByKey(key: string): ReferenceEntry | undefined {
  return MOCK_REFERENCES.find((reference) => reference.key === key);
}

/** 预览页模拟的论文正文行，用于展示金色引用热区 */
export const MOCK_PARAGRAPH_LINES = [
  'The Transformer follows an encoder-decoder architecture using stacked self-attention',
  'and point-wise, fully connected layers, as illustrated in Figure 1. The encoder maps',
  'an input sequence into continuous representations; the decoder then generates tokens',
  'one at a time. Table 1 compares BLEU scores against prior sequence models.',
  'The scaled dot-product attention in Eq. (1) is the core building block, and the',
  'residual connection follows the design of [14]. We also report multi-head results',
  'in Figure 2 and compare convolutional approaches from [12, 15] and [3-5].',
];
