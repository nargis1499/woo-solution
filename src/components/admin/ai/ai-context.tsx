"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PublicAiSettings } from "@/lib/ai/providers";

type NemesisAiContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  openWithPrompt: (prompt?: string) => void;
  promptInput: string;
  setPromptInput: (value: string) => void;
  aiSettings: PublicAiSettings;
  setAiSettings: (next: PublicAiSettings) => void;
};

const NemesisAiContext = createContext<NemesisAiContextValue | null>(null);

export function NemesisAiProvider({
  initialSettings,
  children,
}: {
  initialSettings: PublicAiSettings;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [promptInput, setPromptInput] = useState("");
  const [aiSettings, setAiSettings] = useState<PublicAiSettings>(initialSettings);

  // Sync if RSC refreshes initialSettings underneath
  const [prevUpdatedAt, setPrevUpdatedAt] = useState(initialSettings.updated_at);
  if (prevUpdatedAt !== initialSettings.updated_at) {
    setPrevUpdatedAt(initialSettings.updated_at);
    setAiSettings(initialSettings);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openWithPrompt = useCallback((prompt?: string) => {
    if (prompt !== undefined) setPromptInput(prompt);
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      openWithPrompt,
      promptInput,
      setPromptInput,
      aiSettings,
      setAiSettings,
    }),
    [open, openWithPrompt, promptInput, aiSettings],
  );

  return <NemesisAiContext.Provider value={value}>{children}</NemesisAiContext.Provider>;
}

export function useNemesisAi() {
  const ctx = useContext(NemesisAiContext);
  if (!ctx) {
    throw new Error("useNemesisAi must be used within <NemesisAiProvider>");
  }
  return ctx;
}
