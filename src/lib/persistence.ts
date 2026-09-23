import { parseRocket } from "./rocket/schema";
import type { RocketConfig } from "./rocket/types";

const KEYS = {
  session: "rocketai.session.v1",
  achievements: "rocketai.achievements.v1",
  likes: "rocketai.likes.v1",
  incoming: "rocketai.incoming.v1",
  muted: "rocketai.muted.v1",
};

/** Reads JSON from storage, tolerating missing or blocked storage. */
function read<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Writes JSON to storage, ignoring quota or privacy-mode failures. */
function write(storage: () => Storage, key: string, value: unknown): void {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

/** A saved builder session. */
export interface SavedSession {
  rocket: RocketConfig;
  messages: { role: "user" | "ai"; text: string }[];
}

/** Loads the last builder session, validating the rocket. */
export function loadSession(): SavedSession | null {
  const data = read<{ rocket: unknown; messages: SavedSession["messages"] }>(local, KEYS.session);
  const rocket = data ? parseRocket(data.rocket) : null;
  return rocket ? { rocket, messages: Array.isArray(data!.messages) ? data!.messages.slice(-40) : [] } : null;
}

/** Saves the builder session. */
export function saveSession(value: SavedSession): void {
  write(local, KEYS.session, { rocket: value.rocket, messages: value.messages.slice(-40) });
}

/** Loads unlocked achievement ids. */
export function loadAchievements(): string[] {
  return read<string[]>(local, KEYS.achievements) ?? [];
}

/** Saves unlocked achievement ids. */
export function saveAchievements(ids: string[]): void {
  write(local, KEYS.achievements, ids);
}

/** Loads the set of liked feed posts. */
export function loadLikes(): string[] {
  return read<string[]>(local, KEYS.likes) ?? [];
}

/** Saves the set of liked feed posts. */
export function saveLikes(ids: string[]): void {
  write(local, KEYS.likes, ids);
}

/** A rocket handed to the builder from Explore or a shared page. */
export interface IncomingRocket {
  rocket: RocketConfig;
  prompt: string;
  source: string;
}

/** Queues a rocket for the builder to load on its next mount. */
export function handOff(value: IncomingRocket): void {
  write(session, KEYS.incoming, value);
}

/** Takes (and clears) a queued rocket, if any. */
export function takeHandOff(): IncomingRocket | null {
  const data = read<{ rocket: unknown; prompt: string; source: string }>(session, KEYS.incoming);
  try {
    window.sessionStorage.removeItem(KEYS.incoming);
  } catch {
    /* storage unavailable */
  }
  const rocket = data ? parseRocket(data.rocket) : null;
  return rocket ? { rocket, prompt: String(data!.prompt ?? ""), source: String(data!.source ?? "") } : null;
}

/** Loads the mute preference. */
export function loadMuted(): boolean {
  return read<boolean>(local, KEYS.muted) ?? false;
}

/** Saves the mute preference. */
export function saveMuted(muted: boolean): void {
  write(local, KEYS.muted, muted);
}
