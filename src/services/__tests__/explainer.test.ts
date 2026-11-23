import { afterEach, expect, it, vi } from 'vitest';
import { buildExplanationContext, explanationCacheKey } from '../explanationContext';
import { cachedExplanation, explanationService, MAX_CONTEXT_LENGTH, nativeExplanationReady,
  streamChatExplanation, streamNativeExplanation, subscribeExplanation } from '../explainer';
import { DEFAULT_TRANSLATE_CONFIG, type TranslateConfig } from '../translator';
import type { GlossaryEntry } from '../../types/paper';

const asset = { key: 'fig-1', label: 'Figure 1', caption: 'Figure 1. Results.', pageNumber: 1 };
const rect = (y: number, x = 0.1) => ({ x, y, width: 0.35, height: 0.012 });
const line = (text: string, pageNumber: number, y = 0.3, x = 0.1) => ({ text, pageNumber, rect: rect(y, x) });
const link = (pageNumber: number, y = 0.3) => ({ pageNumber, rect: rect(y), citationId: 'id', rawText: 'Fig. 1' });
const term = (term: string): GlossaryEntry => ({ term, expansion: term + ' definition', definedPage: 7,
  definedRect: rect(0.5), contextSentence: '', kind: 'acronym' });
const config: TranslateConfig = { ...DEFAULT_TRANSLATE_CONFIG, provider: 'openai', apiBaseUrl: 'http://localhost:11434/v1',
  targetLang: 'en', model: 'qwen2.5:7b' };
const signal = () => new AbortController().signal;
const delta = (content: string) => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\r\n\r\n';
afterEach(() => vi.unstubAllGlobals());

it('用回链坐标区分左右栏，跳过图注和重复引用，最多取三段正文及命中术语', () => {
  const pages = { 1: [line(asset.caption, 1)], 2: [line('Fig. 1 uses MHA and BERTScore.', 2),
    line('The result holds across tasks.', 2, 0.316), line('Unrelated column', 2, 0.3, 0.55)],
    3: [line('More discussion', 3)], 4: [line('Third discussion', 4)], 5: [line('Fourth discussion', 5)] };
  const context = buildExplanationContext({ asset }, pages,
    { 'fig-1': [link(1), link(2), link(2, 0.316), link(3), link(4), link(5)] }, { MHA: term('MHA'), BERT: term('BERT') });
  expect(context.text.match(/Discussion \(/g)).toHaveLength(3);
  expect(context.text).toContain('Fig. 1 uses MHA and BERTScore. The result holds across tasks.');
  expect(context.text).toContain('MHA definition');
  expect(context.text).not.toMatch(/Unrelated|Fourth|BERT definition/);
  expect(context.sources.map(s => s.pageNumber)).toEqual([1, 2, 3, 4, 7]);
});

it('长段落截断时保留引用附近的文字，图注、术语及标题均计入总上限', () => {
  const glossary = Object.fromEntries(Array.from({ length: 80 }, (_, i) => ['T' + i, term('T' + i)]));
  const long = 'A'.repeat(3100) + ' Fig. 1 ' + Object.keys(glossary).join(' ') + ' B'.repeat(1000);
  const context = buildExplanationContext({ asset: { ...asset, caption: 'C'.repeat(6000) } },
    { 2: [line(long, 2)], 3: [line(long, 3)], 4: [line(long, 4)] },
    { 'fig-1': [link(2), link(3), link(4)] }, glossary);
  expect(context.text.match(/Fig\. 1/g)).toHaveLength(3);
  expect(context.text).toContain('…');
  expect(context.text).toContain('T0 definition');
  expect(context.text.length).toBeLessThanOrEqual(MAX_CONTEXT_LENGTH);
});

it('解释划词时保留选区、完整所在段以及阅读顺序上跨页的前后各一段', () => {
  const selection = [{ pageNumber: 2, rects: [rect(0.3)], text: 'middle' }];
  const context = buildExplanationContext({ selection },
    { 1: [line('unrelated', 1, 0.2), line('before', 1)], 2: [line('the middle passage', 2)],
      3: [line('after', 3), line('unrelated', 3, 0.6)] }, {}, {});
  expect(context.text).toContain('Selected text (p. 2)\nmiddle');
  for (const passage of ['before', 'the middle passage', 'after']) expect(context.text).toContain(passage);
  expect(context.text).not.toContain('unrelated');
  expect(context.sources.map(s => s.pageNumber)).toEqual([2, 1, 3]);
});

it('按论文、资产或选区位置和目标语言隔离缓存', () => {
  const key = explanationCacheKey('paper', { asset }, 'en');
  expect(explanationCacheKey('paper', { asset: { ...asset, label: 'Fig. 1' } }, 'en')).toBe(key);
  expect(explanationCacheKey('paper', { asset }, 'zh-CN')).not.toBe(key);
  expect(explanationCacheKey('another', { asset }, 'en')).not.toBe(key);
  const selected = (pageNumber: number, y: number) => explanationCacheKey('paper',
    { selection: [{ pageNumber, rects: [rect(y)], text: 'same words' }] }, 'en');
  expect(new Set([selected(1, 0.2), selected(1, 0.6), selected(2, 0.2)]).size).toBe(3);
});

it('逐片解析 SSE，保留跨 UTF-8 字符及 CRLF 边界的数据', async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { writer = c; } })));
  vi.stubGlobal('fetch', fetch);
  const emit = vi.fn();
  const run = streamChatExplanation(config, 'context', signal(), emit);
  const bytes = new TextEncoder().encode(': ping\r\n\r\n' + delta('第一句'));
  for (const byte of bytes) writer.enqueue(Uint8Array.of(byte));
  await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('第一句'));
  writer.enqueue(new TextEncoder().encode(delta('second') + 'data: [DONE]'));
  writer.close();
  await run;
  expect(emit.mock.calls.flat()).toEqual(['第一句', 'second']);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('http://localhost:11434/v1/chat/completions');
  expect(JSON.parse(init.body)).toMatchObject({ model: config.model, stream: true,
    messages: [{ role: 'system', content: expect.stringContaining('English') }, { role: 'user', content: 'context' }] });
  expect(init.headers.Authorization).toBeUndefined();
});

it('拒绝中断、空响应和跨片段回显的密钥，不会展示上游的错误正文', async () => {
  const key = 'private-token';
  const emit = vi.fn();
  for (const data of [delta('incomplete'), 'data: [DONE]\n\n', 'data: {bad}\n\n',
    delta('private-') + delta('token') + 'data: [DONE]\n\n']) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(data)));
    await expect(streamChatExplanation({ ...config, apiKey: key }, 'context', signal(), emit)).rejects.toThrow();
  }
  expect(emit.mock.calls.flat().join('')).not.toContain('private-');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(key, { status: 401 })));
  await expect(streamChatExplanation(config, 'context', signal(), emit)).rejects.toMatchObject({
    uiMessage: { key: 'translate.httpError', params: { status: 401 } },
  });
});

it('免配置通道没有解释服务，外部域名不能被当作本机端点', () => {
  expect(explanationService(DEFAULT_TRANSLATE_CONFIG)).toBeUndefined();
  expect(explanationService(config)).toBe('local');
  expect(explanationService({ ...config, apiBaseUrl: 'http://localhost.example/v1' })).toBe('remote');
  expect(explanationService({ ...config, apiBaseUrl: 'https://localhost@other.example/v1' })).toBe('remote');
});

it('浏览器模型仅在目标语言已就绪时可用，按片输出并释放会话', async () => {
  const destroy = vi.fn();
  const api = { availability: vi.fn().mockResolvedValue('downloadable'), create: vi.fn(async () => ({
    promptStreaming: () => new ReadableStream({ start(c) { c.enqueue('first'); c.enqueue('second'); c.close(); } }), destroy,
  })) };
  vi.stubGlobal('LanguageModel', api);
  expect(await nativeExplanationReady('en')).toBe(false);
  expect(api.create).not.toHaveBeenCalled();
  api.availability.mockResolvedValue('available');
  const emit = vi.fn();
  await streamNativeExplanation('en', 'passage', signal(), emit);
  expect(api.availability).toHaveBeenCalledWith({ expectedOutputs: [{ type: 'text', languages: ['en'] }] });
  expect(emit.mock.calls.flat()).toEqual(['first', 'second']);
  expect(destroy).toHaveBeenCalledOnce();
});

it('同时打开两张卡只请求一次，成功可复用，停止和失败都可重试', async () => {
  let finish!: () => void;
  const run = vi.fn(async (_signal: AbortSignal, emit: (delta: string) => void) => {
    emit('partial');
    await new Promise<void>(resolve => { finish = resolve; });
    emit(' answer');
  });
  const observe = vi.fn();
  const detach = subscribeExplanation('shared', [], run, observe);
  const detachOther = subscribeExplanation('shared', [], run, observe);
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  detach();
  expect(run.mock.calls[0][0].aborted).toBe(false);
  finish();
  await vi.waitFor(() => expect(cachedExplanation('shared')?.text).toBe('partial answer'));
  detachOther();
  subscribeExplanation('shared', [], run, observe)();
  expect(run).toHaveBeenCalledOnce();
  const stop = subscribeExplanation('stopped', [], run, observe);
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  stop();
  expect(run.mock.calls[1][0].aborted).toBe(true);
  finish();
  expect(cachedExplanation('stopped')).toBeUndefined();
  subscribeExplanation('stopped', [], async () => { throw new Error('failed'); }, observe);
  await vi.waitFor(() => expect(observe.mock.lastCall?.[0].error).toBeTruthy());
  expect(cachedExplanation('stopped')).toBeUndefined();
});
