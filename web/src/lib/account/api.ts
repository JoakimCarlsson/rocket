import { request } from "@/lib/api";

/** The signed-in player, as `GET /api/auth/me` reports them. */
export interface Me {
  id: string;
  email: string;
  name: string;
  picture_url: string;
}

/**
 * Returns the signed-in player.
 *
 * @throws {ApiError} With status 401 when nobody is signed in.
 */
export function getMe(): Promise<Me> {
  return request<Me>("/api/auth/me");
}

/** Ends the session and clears its cookie. */
export async function logout(): Promise<void> {
  await request<void>("/api/auth/logout", { method: "POST" }).catch(() => {});
}

/**
 * Hands off to Google. A navigation rather than a fetch, because the answer
 * is a redirect to Google's own origin. With dev auth on and no OAuth client,
 * the API opens a local session instead and redirects straight back.
 */
export function signIn(): void {
  window.location.href = "/api/auth/google/start";
}
