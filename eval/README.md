# 引用识别评测

评测在 Node.js 22+ 中用 pdf.js 打开本地 PDF，复用阅读器的文本分行、文献解析和引用识别。每种通道使用同一份标注。运行 `npm run eval` 后，分组结果写入 `eval/report.md`，逐篇计数和错例写入 `eval/report.json`。这两份报告只在本地生成，不进仓库。

## 复现

在仓库根目录安装项目依赖后运行以下命令。

```sh
npm run eval:fetch
npm run eval
```

第一条命令按固定版本 URL 下载到 `eval/pdfs/<id>.pdf`。已有文件经 SHA-256 校验后跳过。校验失败时，请核对版本并移走错误的缓存，再重新下载。第二条命令只读本地 PDF、CMap 和字体，输出三种通道的结果。已备好 PDF 的机器可离线复现。手动指定通道时，两份报告只包含所选通道，再运行默认命令可恢复对照表。

```sh
npm run eval -- --channel=native
npm run eval -- --channel=text
npm run eval -- --channel=both
npm test
```

## 示范范围

| 论文及版本记录 | 主分组 | 已完整标注的 PDF 页 | 许可 |
| --- | --- | --- | --- |
| [Mistral 7B v1](https://arxiv.org/abs/2310.06825v1) | ieee-numeric | 2、3 | CC BY 4.0 |
| [LLaMA v1](https://arxiv.org/abs/2302.13971v1) | author-year | 7、8 | CC BY 4.0 |
| [Array Programming with NumPy v1](https://arxiv.org/abs/2006.10256v1) | two-column | 3、4 | CC BY 4.0 |
| [Attention Is All You Need v7](https://arxiv.org/abs/1706.03762v7) | latex-hyperref | 3、5 | arXiv 非独占分发许可 |

每篇计入一个主分组。`ieee-numeric` 按方括号数字引文样式归类。前三篇的署名、许可链接和 PDF 校验值均在清单中。第四篇与仓库的 `public/samples/attention.pdf` 字节一致，首页另有 Google 对图表使用的说明。评测目录只收录地址和标注。[语料清单](corpus.json)

## 通道与计分

- **native** 只计引擎从 PDF 内部 Link 注释识别并成功解析目的地的引用。沿用阅读器对链接框内文本的解释与去重。外部网址不参与。
- **text** 只运行文字识别，包含文本正则、作者年份和上标等现有规则。
- **both** 使用阅读器的默认归并结果，同一位置的文本和原生链接可合成一处。

整篇文献表参与目标解析，只有 `reviewedPages` 中的预测和标注参与计分。先把标注原文锚定到同页字形，忽略空白与换行。预测热区与至少一个标注字形有面积交叠即构成文本重叠。按最大一对一匹配计数，优先尝试覆盖字符更多的候选，配对过程只用位置。两处同名引用各算一次。一处跨行标注若产生两个热区，最多匹配一次，多出的预测记为误检。

| 指标 | 分子 | 分母 |
| --- | --- | --- |
| 精确率 | 匹配的引用处数 | 评测页上的预测处数 |
| 召回率 | 匹配的引用处数 | 评测页上的标注处数 |
| 目标定位正确率 | 匹配且预测与标注的 `targetKeys` 至少有一个相同的处数 | 匹配的引用处数 |

分组和合计先累加原始计数，再求比值。Markdown 中的 — 和 JSON 中的 `null` 表示分母为零。JSON 的 `missed`、`extra`、`wrongTarget` 分别列出漏检、多出的预测和目标不符。定位指标衡量返回的目标 key，不校验跳转坐标或预览裁图。

## 标注新样本

1. 在 `corpus.json` 填写唯一 id、分组、来源和许可。远程 PDF 填固定版本的 `url` 与 `sha256`。本地 PDF 填 `"local": true`，将文件放在 `eval/pdfs/<id>.pdf`。本地文件也可填写校验值。该目录由 Git 忽略。
2. 在原始 PDF 上选择要完整检查的页面，使用阅读器显示的 PDF 物理页码，从 1 开始。逐页标出所有指向图、表、公式、文献及编号章节等引擎支持目标的引用，包括图题或表注中提及的其他目标。图表自身的标题编号、公式自身编号、文献表条目和普通脚注编号均排除。完全没有引用的已审页也列入 `reviewedPages`，用于统计误检。
3. 创建 `eval/labels/<id>.json`。照抄引用原文，按原文实际指向填 key。表格使用引擎的 `tab-2`，子图使用 `fig-1b`，无编号的作者年份文献示例为 `ref-ay-smith-2022`。同一组括号内的多个目标作为一处，逐一列出 key。
4. 同页有多个相同片段时，用含引用的短句 `context` 消歧，也可用从 1 开始的 `occurrence` 指定按页面阅读顺序出现的次数。计次包含图表标题中的相同片段。脚本对歧义、重复和无法锚定的标注报错。核对完整后移除清单条目的 `todo` 再运行评测。TODO 条目不参与分母。

```json
{
  "reviewedPages": [1, 2],
  "citations": [
    { "pageNumber": 1, "text": "图 1", "context": "如图 1 所示", "targetKeys": ["fig-1"] },
    { "pageNumber": 2, "text": "[4]", "targetKeys": ["ref-4"] }
  ]
}
```

## 用 Word 制作无超链接组

1. 新建两页以上的原创测试文档，使用分页符固定评测页。在正文写入“如图 1 所示”“见表 2”“式(3)”和“[4]”，另写英文 “Fig. 1”“Table 2”“Eq. (3)”。可在不同段落重复其中一处，或加一个没有引用的段落。
2. 加入对应的图 1、表 2、编号为 (3) 的公式和包含条目 [4] 的参考文献表。引用用普通文本输入。若用 Word 的交叉引用域，取消“插入为超链接”，并移除已有超链接。
3. 在 Windows Word 中使用“文件 → 打印 → Microsoft Print to PDF”生成 `eval/pdfs/word-example.pdf`。确认能选中正文文字。用下列命令检查所有页的 Link 注释数，预期为 0。若大于 0，请检查超链接并重新打印。

```sh
node --input-type=module -e "import {readFile} from 'node:fs/promises'; import {getDocument} from 'pdfjs-dist'; const d=await getDocument({data:new Uint8Array(await readFile('eval/pdfs/word-example.pdf'))}).promise; let links=0; for(let p=1;p<=d.numPages;p++){const page=await d.getPage(p); links+=(await page.getAnnotations()).filter(a=>a.subtype==='Link').length} console.log(links); await d.destroy()"
```

4. 根据**导出后的 PDF** 编写 `eval/labels/word-example.json`，填写实际许可并移除对应 TODO。运行 `npm run eval`，检查 Word 行原生通道的预测数为零，再逐项复核文本与双通道的命中。后续上标、中文期刊和单栏样本沿用同一标注流程。
