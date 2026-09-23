"use client";

import { useSyncExternalStore } from "react";

/** Subscribes to a CSS media query; returns false during server rendering. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True on phone-sized screens. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
