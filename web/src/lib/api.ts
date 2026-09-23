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
 * Sends a same-origin request to the API and parses the JSON answer. A body
 * given as `json` is serialised and sent as JSON.
 *
 * @throws {ApiError} When the API answers with a non-2xx status.
 */
export async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    cache: "no-store",
    ...(json !== undefined && {
      body: JSON.stringify(json),
      headers: { "Content-Type": "application/json", ...rest.headers },
    }),
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const problem = (await response.json()) as Problem;
      detail = problem.detail ?? problem.title ?? detail;
    } catch {}
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
