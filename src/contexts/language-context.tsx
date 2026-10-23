import { createContext, useContext, useState } from 'react';
import type { Dispatch, PropsWithChildren, SetStateAction } from 'react';

import type { LanguageLabel } from '@/constants/safety-content';

type LanguageContextValue = {
  languageLabel: LanguageLabel;
  setLanguageLabel: Dispatch<SetStateAction<LanguageLabel>>;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: PropsWithChildren) {
  const [languageLabel, setLanguageLabel] = useState<LanguageLabel>('English');

  return (
    <LanguageContext.Provider value={{ languageLabel, setLanguageLabel }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useAppLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useAppLanguage must be used inside LanguageProvider.');
  }
  return context;
}
