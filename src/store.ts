import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LibraryView, ThemeMode } from "./types";

export type ThemeStyle = "soft" | "vivid" | "expressive" | "accurate" | "content" | "neutral" | "mono" | "rainbow";

interface PreferencesState {
  theme: ThemeMode;
  libraryView: LibraryView;
  accentHue: number;
  accentSat: number;
  accentLight: number;
  themeStyle: ThemeStyle;
  coverBrightness: number;
  amoled: boolean;
  dynamicColor: boolean;
  fontScale: number;
  shadowScale: number;
  glassBlur: number;
  cornerRadius: number;
  topbarOpacity: number;
  shelfColumns: number;
  setTheme: (theme: ThemeMode) => void;
  setLibraryView: (view: LibraryView) => void;
  setAccentHue: (accentHue: number) => void;
  setAccentSat: (accentSat: number) => void;
  setAccentLight: (accentLight: number) => void;
  setThemeStyle: (themeStyle: ThemeStyle) => void;
  setCoverBrightness: (coverBrightness: number) => void;
  setAmoled: (amoled: boolean) => void;
  setDynamicColor: (dynamicColor: boolean) => void;
  setFontScale: (fontScale: number) => void;
  setShadowScale: (shadowScale: number) => void;
  setGlassBlur: (glassBlur: number) => void;
  setCornerRadius: (cornerRadius: number) => void;
  setTopbarOpacity: (topbarOpacity: number) => void;
  setShelfColumns: (shelfColumns: number) => void;
  resetAppearance: () => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      libraryView: "grid",
      accentHue: 158,
      accentSat: 55,
      accentLight: 55,
      themeStyle: "soft",
      coverBrightness: 100,
      amoled: false,
      dynamicColor: false,
      fontScale: 100,
      shadowScale: 1,
      glassBlur: 24,
      cornerRadius: 8,
      topbarOpacity: 0,
      shelfColumns: 7,
      setTheme: (theme) => set({ theme }),
      setLibraryView: (libraryView) => set({ libraryView }),
      setAccentHue: (accentHue) => set({ accentHue }),
      setAccentSat: (accentSat) => set({ accentSat }),
      setAccentLight: (accentLight) => set({ accentLight }),
      setThemeStyle: (themeStyle) => set({ themeStyle }),
      setCoverBrightness: (coverBrightness) => set({ coverBrightness }),
      setAmoled: (amoled) => set({ amoled }),
      setDynamicColor: (dynamicColor) => set({ dynamicColor }),
      setFontScale: (fontScale) => set({ fontScale }),
      setShadowScale: (shadowScale) => set({ shadowScale }),
      setGlassBlur: (glassBlur) => set({ glassBlur }),
      setCornerRadius: (cornerRadius) => set({ cornerRadius }),
      setTopbarOpacity: (topbarOpacity) => set({ topbarOpacity }),
      setShelfColumns: (shelfColumns) => set({ shelfColumns }),
      resetAppearance: () => set({ theme: "system", accentHue: 158, accentSat: 55, accentLight: 55, themeStyle: "soft", coverBrightness: 100, amoled: false, dynamicColor: false, fontScale: 100, shadowScale: 1, glassBlur: 24, cornerRadius: 8, topbarOpacity: 0, shelfColumns: 7 }),
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

interface UiState {
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUi = create<UiState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
