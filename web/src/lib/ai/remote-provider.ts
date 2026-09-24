import { analyzeRocket } from "../physics/api";
import { type AIResult, validateModelOutput } from "./actions";
import { buildUserMessage } from "./prompt";
import type { AIProvider, InterpretRequest } from "./provider";

/** Thrown when the server has no model configured or the call failed. */
export class ProviderUnavailableError extends Error {}

/** Provider that sends the built user turn to the API's `/api/ai` endpoint, which talks to a hosted model. */
export class RemoteProvider implements AIProvider {
  readonly id: string;
  readonly label: string;

  /** Creates a remote provider for a server-side model with a display label. */
  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }

  /** Sends the request to the server and validates whatever comes back. */
  async interpret(request: InterpretRequest): Promise<AIResult> {
    const analysis = await analyzeRocket(request.rocket);
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: buildUserMessage(request, analysis) }),
    });
    if (!response.ok)
      throw new ProviderUnavailableError(
        `AI route returned ${response.status}`,
      );
    return validateModelOutput(await response.json(), this.id);
  }
}

/** Status reported by `GET /api/ai`. */
export interface ProviderStatus {
  available: boolean;
  id: string;
  label: string;
}

/** Asks the server whether a hosted model is configured. */
export async function fetchProviderStatus(): Promise<ProviderStatus> {
  try {
    const response = await fetch("/api/ai", { cache: "no-store" });
    if (!response.ok) return { available: false, id: "none", label: "" };
    return (await response.json()) as ProviderStatus;
  } catch {
    return { available: false, id: "none", label: "" };
  }
}
