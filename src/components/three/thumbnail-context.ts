"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { RocketConfig } from "@/lib/rocket/types";

/** Asks the hidden renderer for a thumbnail data URL. */
export type ThumbnailRequest = (key: string, rocket: RocketConfig) => Promise<string>;

/** Provided by `ThumbnailProvider`; null when no renderer is mounted. */
export const ThumbnailContext = createContext<ThumbnailRequest | null>(null);

/** Rendered thumbnails by key, shared for the lifetime of the page. */
export const thumbnailCache = new Map<string, string>();

/** Returns a thumbnail data URL for a rocket, rendering it on demand. */
export function useThumbnail(key: string, rocket: RocketConfig, enabled = true): string | null {
  const request = useContext(ThumbnailContext);
  const [url, setUrl] = useState<string | null>(() => thumbnailCache.get(key) ?? null);
  useEffect(() => {
    if (!request || !enabled || url) return;
    let alive = true;
    void request(key, rocket).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [request, key, rocket, enabled, url]);
  return url;
}
