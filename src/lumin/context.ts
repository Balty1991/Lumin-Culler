import { createContext, useContext } from 'react';
import { useStore } from '../state/store';
import { t } from '../i18n';

/** Acțiunile pe care le dă rădăcina (LuminApp) ecranelor: deocamdată, alegerea pozelor. */
export interface LxActions {
  pick: () => void;
}

export const LxActionsContext = createContext<LxActions>({ pick: () => {} });

export function useLxActions(): LxActions {
  return useContext(LxActionsContext);
}

export function useTr(): (key: string, params?: Record<string, string | number>) => string {
  const locale = useStore(s => s.locale);
  return (key, params) => t(locale, key, params);
}
