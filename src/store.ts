import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LibraryView, ThemeMode } from "./types";

interface PreferencesState {
  theme: ThemeMode;
  libraryView: LibraryView;
  accentHue: number;
  glassBlur: number;
  cornerRadius: number;
  setTheme: (theme: ThemeMode) => void;
  setLibraryView: (view: LibraryView) => void;
  setAccentHue: (accentHue: number) => void;
  setGlassBlur: (glassBlur: number) => void;
  setCornerRadius: (cornerRadius: number) => void;
  resetAppearance: () => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      libraryView: "grid",
      accentHue: 158,
      glassBlur: 24,
      cornerRadius: 8,
      setTheme: (theme) => set({ theme }),
      setLibraryView: (libraryView) => set({ libraryView }),
      setAccentHue: (accentHue) => set({ accentHue }),
      setGlassBlur: (glassBlur) => set({ glassBlur }),
      setCornerRadius: (cornerRadius) => set({ cornerRadius }),
      resetAppearance: () => set({ theme: "system", accentHue: 158, glassBlur: 24, cornerRadius: 8 }),
    }),
    { name: "genzo-preferences" },
  ),
);

export type ToastTone = "success" | "error" | "info";
export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

interface ToastState {
  messages: ToastMessage[];
  push: (text: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

let nextToastId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  messages: [],
  push: (text, tone = "info") => {
    const id = nextToastId++;
    set({ messages: [...get().messages, { id, text, tone }] });
    window.setTimeout(() => get().dismiss(id), 4200);
  },
  dismiss: (id) => set({ messages: get().messages.filter((message) => message.id !== id) }),
}));
