"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isLanguageId, type LanguageId } from "@config/languages";
import type { HealthReport } from "@/core/health";
import { strings, type UiStrings } from "@/lib/i18n";

interface AppState {
  language: LanguageId;
  setLanguage: (language: LanguageId) => void;
  t: UiStrings;
  /** Profile id kept on this device; there are no accounts in the demo. */
  farmerId: string | null;
  setFarmerId: (id: string | null) => void;
  health: HealthReport | null;
  refreshHealth: () => void;
}

const AppContext = createContext<AppState | null>(null);

const LANGUAGE_KEY = "khetmitra.language";
const FARMER_KEY = "khetmitra.farmerId";

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // private mode / storage disabled: the app still works for this session
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageId>("hi");
  const [farmerId, setFarmerIdState] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);

  useEffect(() => {
    // Hydrate saved preferences after mount (localStorage isn't available during SSR).
    const savedLanguage = readStorage(LANGUAGE_KEY);
    const savedFarmer = readStorage(FARMER_KEY);
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from storage */
    if (savedLanguage && isLanguageId(savedLanguage)) setLanguageState(savedLanguage);
    if (savedFarmer) setFarmerIdState(savedFarmer);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const refreshHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<HealthReport>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    refreshHealth();
    const timer = setInterval(refreshHealth, 120_000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  const value = useMemo<AppState>(
    () => ({
      language,
      setLanguage: (l) => {
        setLanguageState(l);
        writeStorage(LANGUAGE_KEY, l);
      },
      t: strings(language),
      farmerId,
      setFarmerId: (id) => {
        setFarmerIdState(id);
        writeStorage(FARMER_KEY, id);
      },
      health,
      refreshHealth,
    }),
    [language, farmerId, health, refreshHealth],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
