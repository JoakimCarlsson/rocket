import type { InterpretRequest } from "../provider";

/** Server-side model backend. Implementations return raw JSON that the caller validates. */
export interface ModelClient {
  readonly id: string;
  readonly label: string;
  complete(request: InterpretRequest): Promise<unknown>;
}
