import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LibraryView, ThemeMode } from "./types";

interface PreferencesState {
  theme: ThemeMode;
  libraryView: LibraryView;
  setTheme: (theme: ThemeMode) => void;
  setLibraryView: (view: LibraryView) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      libraryView: "grid",
      setTheme: (theme) => set({ theme }),
      setLibraryView: (libraryView) => set({ libraryView }),
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
