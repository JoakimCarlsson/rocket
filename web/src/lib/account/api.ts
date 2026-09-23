/** The signed-in player, as `GET /api/auth/me` reports them. */
export interface Me {
  id: string;
  email: string;
  name: string;
  picture_url: string;
}

/** Thrown for a non-2xx answer from the API, carrying its status. */
export class ApiError extends Error {
  readonly status: number;

  /** Creates an error for a response that came back with status. */
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** The RFC 9457 error body the API returns. */
interface Problem {
  detail?: string;
  title?: string;
}

/**
 * Sends a same-origin request to the API and parses the JSON answer.
 *
 * @throws {ApiError} When the API answers with a non-2xx status.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const problem = (await response.json()) as Problem;
      detail = problem.detail ?? problem.title ?? detail;
    } catch {}
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
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
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}

/**
 * Hands off to Google. A navigation rather than a fetch, because the answer
 * is a redirect to Google's own origin. With dev auth on and no OAuth client,
 * the API opens a local session instead and redirects straight back.
 */
export function signIn(): void {
  window.location.href = "/api/auth/google/start";
}
