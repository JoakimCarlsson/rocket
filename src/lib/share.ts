import { parseRocket } from "./rocket/schema";
import type { RocketConfig } from "./rocket/types";

/** Everything a shared link carries. The launch outcome is recomputed from `attempt`. */
export interface SharePayload {
  rocket: RocketConfig;
  prompt: string;
  creator: string;
  attempt: number | null;
}

/** Rounds numbers so encoded links stay short without changing how the rocket looks. */
function compact(value: unknown): unknown {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(compact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, compact(v)]),
    );
  return value;
}

/** Encodes bytes as URL-safe base64. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decodes URL-safe base64 into bytes. */
function fromBase64Url(value: string): Uint8Array {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Serialises a rocket into a deterministic id usable in `/r/[id]`. */
export function encodeShare(payload: SharePayload): string {
  const json = JSON.stringify({
    r: compact(payload.rocket),
    p: payload.prompt.slice(0, 200),
    c: payload.creator.slice(0, 32),
    a: payload.attempt,
  });
  return toBase64Url(new TextEncoder().encode(json));
}

/** Parses a share id back into a validated payload, or null if it is not one. */
export function decodeShare(id: string): SharePayload | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(id)));
    const rocket = parseRocket(data.r);
    if (!rocket) return null;
    return {
      rocket,
      prompt: typeof data.p === "string" ? data.p.slice(0, 200) : "",
      creator: typeof data.c === "string" ? data.c.slice(0, 32) : "@anonymous",
      attempt: typeof data.a === "number" ? data.a : null,
    };
  } catch {
    return null;
  }
}

/** Builds an absolute share URL for the current origin. */
export function shareUrl(id: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/r/${id}`;
}
