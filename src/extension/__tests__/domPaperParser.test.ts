// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { extractDomPaper } from '../domPaperParser';

afterEach(() => { document.body.replaceChildren(); });

it('indexes scholarly assets, nested headings, definitions and their exact HTML mentions', () => {
  document.body.innerHTML = `<article class="ltx_document">
    <nav><h2>Navigation</h2><a href="#a1">Algorithm 1</a></nav>
    <section id="methods"><h2 id="heading">2 Methods</h2>
      <h3>2.1 Training</h3>
      <p id="terms">Multi-Head Attention (MHA) is used, where α denotes the learning rate.</p>
      <figure id="a1"><figcaption>Algorithm 1: Fit the model</figcaption><pre>return x</pre></figure>
      <div id="a2" class="ltx_algorithm">Algorithm 2 Decode</div>
      <div class="ltx_theorem" id="t1"><h4 class="ltx_title">Theorem 1</h4>Convergence.</div>
      <div id="l1" class="ltx_lemma"><b class="ltx_title">Lemma 1</b>Bound.</div>
      <div class="ltx_definition">Definition 3 Representation.</div>
      <p>See <a id="mention" href="#a1">Algorithm 1</a>, Theorem 1, <a href="#l1">Lemma 1</a>
        and <a href="#methods">Section 2</a>. Algorithm 1 follows <a href="#r1">[1]</a>. 第 2 节。</p>
      <a href="https://another.example/paper#a1">Algorithm 1</a>
      <ol id="references"><li id="r1">[1] A. Author. An example paper. 2020.</li></ol>
    </section></article>`;
  const paper = extractDomPaper();
  const { assets, outline, backlinksMap, glossaryMap } = paper.payload;
  expect(assets.map(asset => [asset.key, asset.kind])).toEqual(expect.arrayContaining([
    ['alg-1', 'algorithm'], ['alg-2', 'algorithm'], ['thm-1', 'theorem'], ['lem-1', 'theorem'],
    ['def-3', 'theorem'], ['sec-2', 'section'], ['sec-2.1', 'section'],
  ]));
  expect(outline).toMatchObject([{ title: '2 Methods', domAnchorId: 'heading', children: [{ title: '2.1 Training' }] }]);
  expect(glossaryMap.MHA).toMatchObject({ expansion: 'Multi-Head Attention', domAnchorId: 'terms', kind: 'acronym' });
  expect(glossaryMap['α']).toMatchObject({ expansion: 'the learning rate', kind: 'symbol', domAnchorId: 'terms' });
  expect(backlinksMap['alg-1']).toHaveLength(2);
  expect(backlinksMap['alg-1'][0].domAnchorId).toBe('mention');
  for (const key of ['thm-1', 'lem-1', 'ref:1']) expect(backlinksMap[key]).toHaveLength(1);
  expect(backlinksMap['sec-2']).toHaveLength(2);
  expect(paper.payload.citationCount).toBe(7);
  for (const links of Object.values(backlinksMap)) for (const link of links) {
    expect(paper.anchorElements.get(link.domAnchorId!)?.textContent).toBe(link.rawText);
  }
  expect(extractDomPaper().payload).toEqual(paper.payload);
});

it('leaves ordinary pages untouched until explicitly scanned', () => {
  document.body.innerHTML = '<h2>1 Intro</h2><p>Multi-Head Attention (MHA).</p>';
  expect(extractDomPaper().payload).toMatchObject({ outline: [], glossaryMap: {}, backlinksMap: {}, isAcademicPage: false });
  expect(document.querySelector('[data-refpin-anchor]')).toBeNull();
  expect(extractDomPaper(true).payload.outline).toHaveLength(1);
});
