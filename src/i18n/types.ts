import type { en } from './locales/en';

export type Locale = 'en' | 'zh-CN';
export type MessageKey = keyof typeof en;

type Placeholders<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

export type MessageArgs<K extends MessageKey> =
  [Placeholders<(typeof en)[K]>] extends [never] ? [] :
    [params: Record<Placeholders<(typeof en)[K]>, string | number>];

/** A message can be kept in state or passed between extension contexts before rendering. */
export interface LocalizedMessage {
  key: MessageKey;
  params?: Record<string, string | number>;
  detail?: string;
}
export type DisplayMessage = LocalizedMessage | string;
