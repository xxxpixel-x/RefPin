import type { PaperAsset } from '../../types/paper';

export interface PreviewFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

interface HostSize {
  innerWidth: number;
  innerHeight: number;
}

export const PREVIEW_MIN_WIDTH = 280;
export const PREVIEW_MIN_HEIGHT = 200;
export const PREVIEW_MARGIN = 8;
/** 标题栏高度（h-10）。 */
const TITLE_BAR = 40;
/** 图片区内边距（p-3，两侧）加上外框。 */
const CHROME = 24 + 2;
/** 小截图最多放大到原尺寸的这么多倍，避免发糊。 */
const MAX_UPSCALE = 2;
const CASCADE_STEP = 28;
const CASCADE_SLOTS = 8;
/** 同时打开的浮窗上限，超出时关闭最早打开的那个。 */
export const MAX_PREVIEW_WINDOWS = 6;

/** 没有图片尺寸时的默认大小，与旧版放大浮窗一致。 */
function fallbackSize(host: HostSize) {
  return {
    width: Math.max(PREVIEW_MIN_WIDTH, Math.min(880, Math.round(host.innerWidth * 0.6))),
    height: Math.max(PREVIEW_MIN_HEIGHT, Math.min(680, Math.round(host.innerHeight * 0.7))),
  };
}

/**
 * 按截图的长宽比计算浮窗默认大小：在视口 60%×75% 的范围内尽量放大图片，
 * 再加上标题栏与内边距；多个浮窗依次错开。
 */
export function fitPreviewFrame(image: ImageSize | null, host: HostSize, cascade = 0): PreviewFrame {
  let { width, height } = fallbackSize(host);
  if (image && image.width > 0 && image.height > 0) {
    const maxWidth = Math.min(host.innerWidth - PREVIEW_MARGIN * 2, Math.max(PREVIEW_MIN_WIDTH, Math.round(host.innerWidth * 0.6)), 960);
    const maxHeight = Math.min(host.innerHeight - PREVIEW_MARGIN * 2, Math.max(PREVIEW_MIN_HEIGHT, Math.round(host.innerHeight * 0.75)));
    const scale = Math.min(
      (maxWidth - CHROME) / image.width,
      (maxHeight - TITLE_BAR - CHROME) / image.height,
      MAX_UPSCALE,
    );
    width = Math.max(PREVIEW_MIN_WIDTH, Math.round(image.width * scale + CHROME));
    height = Math.max(PREVIEW_MIN_HEIGHT, Math.round(image.height * scale + TITLE_BAR + CHROME));
  }
  const offset = (cascade % CASCADE_SLOTS) * CASCADE_STEP;
  return clampPreviewFrame({
    left: Math.round((host.innerWidth - width) / 2) + offset,
    top: Math.round((host.innerHeight - height) / 2) + offset,
    width,
    height,
  }, host);
}

/** 保证浮窗不超出视口，并始终留出可拖回的标题栏。 */
export function clampPreviewFrame(frame: PreviewFrame, host: HostSize, visibleGrab = 80): PreviewFrame {
  const width = Math.min(Math.max(PREVIEW_MIN_WIDTH, frame.width), host.innerWidth - PREVIEW_MARGIN * 2);
  const height = Math.min(Math.max(PREVIEW_MIN_HEIGHT, frame.height), host.innerHeight - PREVIEW_MARGIN * 2);
  const left = Math.min(Math.max(frame.left, visibleGrab - width), host.innerWidth - visibleGrab);
  const top = Math.min(Math.max(frame.top, PREVIEW_MARGIN), host.innerHeight - 48);
  return { left, top, width, height };
}

/** 读出图片的实际像素尺寸；读不到时返回 null，浮窗退回默认大小。 */
export function loadImageSize(url: string | undefined, timeoutMs = 1500): Promise<ImageSize | null> {
  if (!url || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image.naturalWidth > 0 ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

export interface PreviewWindow {
  id: string;
  asset: PaperAsset;
  /** 从钉板打开的浮窗跟随钉板显示在弹出的小窗里。 */
  fromDock: boolean;
  frame: PreviewFrame;
}

/** 列表顺序即叠放顺序，最后一个在最前面。 */
export function focusPreview(list: PreviewWindow[], id: string): PreviewWindow[] {
  const index = list.findIndex(item => item.id === id);
  if (index < 0 || index === list.length - 1) return list;
  return [...list.slice(0, index), ...list.slice(index + 1), list[index]];
}

export function openPreview(list: PreviewWindow[], next: PreviewWindow, max = MAX_PREVIEW_WINDOWS): PreviewWindow[] {
  if (list.some(item => item.id === next.id)) return focusPreview(list, next.id);
  const appended = [...list, next];
  return appended.length > max ? appended.slice(appended.length - max) : appended;
}

export function closePreview(list: PreviewWindow[], id: string): PreviewWindow[] {
  return list.filter(item => item.id !== id);
}

/** 满足条件的最后一个下标（ES2020 目标下没有 Array.prototype.findLastIndex）。 */
export function lastIndexWhere<T>(list: readonly T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (test(list[i])) return i;
  return -1;
}
