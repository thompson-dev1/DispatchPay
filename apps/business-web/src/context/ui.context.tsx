import { createContext, PropsWithChildren, useContext, useMemo, useState } from 'react';

type Theme = 'light' | 'dark';

interface UiContextValue {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  activeFilter: string;
  setActiveFilter: (filter: string) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: PropsWithChildren) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>('light');
  const [activeFilter, setActiveFilter] = useState('all');

  const value = useMemo<UiContextValue>(
    () => ({ sidebarOpen, setSidebarOpen, theme, setTheme, activeFilter, setActiveFilter }),
    [sidebarOpen, theme, activeFilter]
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi() {
  const ctx = useContext(UiContext);
  if (!ctx) {
    throw new Error('useUi must be used within UiProvider');
  }
  return ctx;
}
