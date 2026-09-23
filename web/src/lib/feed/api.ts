import { request } from "@/lib/api";
import { parseRocket } from "@/lib/rocket/schema";
import type { RocketConfig } from "@/lib/rocket/types";
import { type LaunchPlan, simulateLaunch } from "@/lib/sim/simulate";

/** A published rocket on the Explore feed. */
export interface FeedPost {
  id: string;
  name: string;
  creator: string;
  prompt: string;
  rocket: RocketConfig;
  likes: number;
  liked: boolean;
  mine: boolean;
  plan: LaunchPlan;
}

/** One page of the feed. `next` is empty on the last page. */
export interface FeedPage {
  posts: FeedPost[];
  next: string;
}

/** A published rocket as `/api/rockets` returns it. */
interface RocketResponse {
  id: string;
  creator: string;
  name: string;
  prompt: string;
  config: unknown;
  likes: number;
  liked: boolean;
  mine: boolean;
}

/** A rocket's like state after a change. */
export interface LikeState {
  likes: number;
  liked: boolean;
}

/** Matches the ids the API hands out, telling a published rocket apart from an encoded one. */
const ROCKET_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reports whether a share id names a published rocket. */
export function isPublishedId(id: string): boolean {
  return ROCKET_ID.test(id);
}

/** Turns a display name into a feed handle. */
function handle(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `@${slug || "anonymous"}`;
}

/** Validates a published rocket into a post, or null when its config no longer parses. */
function toPost(data: RocketResponse): FeedPost | null {
  const rocket = parseRocket(data.config);
  if (!rocket) return null;
  return {
    id: data.id,
    name: data.name,
    creator: handle(data.creator),
    prompt: data.prompt,
    rocket: { ...rocket, name: data.name },
    likes: data.likes,
    liked: data.liked,
    mine: data.mine,
    plan: simulateLaunch(rocket, 1),
  };
}

/** Reads one page of the feed, starting after the cursor `before`. */
export async function fetchFeed(before = ""): Promise<FeedPage> {
  const query = before ? `?${new URLSearchParams({ before })}` : "";
  const data = await request<{ rockets: RocketResponse[]; next: string }>(
    `/api/rockets${query}`,
  );
  return {
    posts: data.rockets.flatMap((r) => toPost(r) ?? []),
    next: data.next,
  };
}

/** Reads one published rocket, or null when there is none with that id. */
export async function fetchPost(id: string): Promise<FeedPost | null> {
  try {
    return toPost(
      await request<RocketResponse>(`/api/rockets/${encodeURIComponent(id)}`),
    );
  } catch {
    return null;
  }
}

/**
 * Publishes a rocket to Explore as the signed-in player.
 *
 * @throws {ApiError} With status 401 when nobody is signed in.
 */
export async function publishRocket(
  rocket: RocketConfig,
  prompt: string,
): Promise<FeedPost> {
  const data = await request<RocketResponse>("/api/rockets", {
    method: "POST",
    json: { name: rocket.name, prompt: prompt.slice(0, 200), config: rocket },
  });
  const post = toPost(data);
  if (!post) throw new Error("The published rocket did not read back");
  return post;
}

/**
 * Likes or unlikes a rocket as the signed-in player.
 *
 * @throws {ApiError} With status 401 when nobody is signed in.
 */
export function setLiked(id: string, liked: boolean): Promise<LikeState> {
  return request<LikeState>(`/api/rockets/${encodeURIComponent(id)}/like`, {
    method: liked ? "PUT" : "DELETE",
  });
}
