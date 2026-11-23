import { useEffect, useState } from 'react';
import { canUseExtensionSettings, getExtensionTranslateSettings, type ExtensionTranslateSettings, type TranslateConfig } from './translator';

export function useExtensionTranslateSettings(config: TranslateConfig | null, settingsOpen = false) {
  const [settings, setSettings] = useState<ExtensionTranslateSettings | null>(null);
  useEffect(() => {
    if (!config || !canUseExtensionSettings(config)) { setSettings(null); return; }
    let active = true;
    const refresh = () => {
      void getExtensionTranslateSettings(config).then(next => { if (active) setSettings(next); });
    };
    const onReady = (event: MessageEvent) => {
      if (event.source === window && event.origin === location.origin &&
          event.data?.source === 'refpin-extension' && event.data.type === 'REFPIN_EXT_READY') refresh();
    };
    refresh();
    window.addEventListener('message', onReady);
    return () => { active = false; window.removeEventListener('message', onReady); };
  }, [config, settingsOpen]);
  return config && canUseExtensionSettings(config) ? settings : null;
}
