import { CommandDialog, type Command } from '../../components/layout/CommandPalette';
import { useI18n } from '../../i18n';
import { useReaderStore } from '../../store/useReaderStore';
import type { OutlineItem } from '../../types/paper';
import type { CompanionAsset, CompanionIndex, CompanionPinItem, CompanionReference } from '../protocol';

export function flattenOutline(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap(item => [item, ...flattenOutline(item.children)]);
}

interface Props {
  index: CompanionIndex;
  assets: CompanionAsset[];
  references: CompanionReference[];
  numPages: number;
  canExport: boolean;
  onJump: (page?: number | null, anchor?: string) => void;
  onPinAsset: (asset: CompanionAsset) => void;
  onPinReference: (ref: CompanionReference) => void;
  onPin: (item: CompanionPinItem) => void;
  onOpenReader: () => void;
  onExport: (mode: 'copy' | 'zip') => void;
  onClose: () => void;
}

export function CompanionCommands(props: Props) {
  const { t, locale, setLocale } = useI18n();
  const { index, assets, references, onJump, onPin, onClose } = props;
  const actions = [
    ['panel.fullReader', props.onOpenReader],
    ['language.switch', () => setLocale(locale === 'en' ? 'zh-CN' : 'en')],
    ...(['light', 'sepia', 'dark'] as const).map(theme =>
      [`theme.${theme}`, () => useReaderStore.getState().setTheme(theme)] as const),
    ...(props.canExport ? [
      ['notes.copy', () => props.onExport('copy')], ['notes.zip', () => props.onExport('zip')],
    ] as const : []),
  ] as const;
  const commands: Command[] = actions.map(([key, run]) => ({
    id: key, label: t(key), keywords: key, category: t('palette.actions'), run,
  }));
  for (const asset of assets) commands.push({
    id: asset.key, label: asset.label, keywords: asset.caption, shortcut: asset.key.replace(/^table:/, 'tab-').replace(':', '-'),
    category: t(`kind.${asset.kind}`), run: () => onJump(asset.pageNumber, asset.domAnchorId), pin: () => props.onPinAsset(asset),
  });
  for (const ref of references) commands.push({
    id: ref.key, label: '[' + ref.index + '] ' + ref.title, keywords: ref.rawText, shortcut: 'ref-' + ref.index,
    category: t('kind.reference'), run: () => onJump(ref.pageNumber, ref.domAnchorId), pin: () => props.onPinReference(ref),
  });
  for (const item of flattenOutline(index.outline)) {
    if (!item.pageNumber && !item.domAnchorId) continue;
    const id = 'outline-' + item.id;
    commands.push({ id, label: item.title, category: t('outline.title'), run: () => onJump(item.pageNumber, item.domAnchorId),
      pin: () => onPin({ id, kind: 'section', title: item.title, pageNumber: item.pageNumber ?? undefined,
        domAnchorId: item.domAnchorId, source: item.domAnchorId ? 'dom' : 'pdf', pinnedAt: Date.now() }) });
  }
  for (const term of Object.values(index.glossaryMap)) {
    const id = 'term-' + term.term;
    commands.push({ id, label: term.term + ' · ' + term.expansion, keywords: term.contextSentence, category: t('glossary.title'),
      run: () => onJump(term.definedPage, term.domAnchorId),
      pin: () => onPin({ id, kind: 'glossary', title: term.term, subtitle: term.expansion, textPreview: term.contextSentence,
        pageNumber: term.definedPage || undefined, domAnchorId: term.domAnchorId, source: term.domAnchorId ? 'dom' : 'pdf', pinnedAt: Date.now() }) });
  }
  return <CommandDialog commands={commands} onJump={onJump} numPages={props.numPages} onClose={onClose} />;
}
