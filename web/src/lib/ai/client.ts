import type { AIResult } from "./actions";
import type { AIProvider, InterpretRequest } from "./provider";
import {
  fetchProviderStatus,
  ProviderUnavailableError,
  RemoteProvider,
} from "./remote-provider";

/** Label shown while no hosted model is configured. */
export const OFFLINE_LABEL = "OFFLINE";

/** Provider used by the UI: the hosted model behind `/api/ai`, once the server reports one. */
export class EngineerClient implements AIProvider {
  readonly id = "engineer";
  private remote: RemoteProvider | null = null;
  private status: Promise<void> | null = null;

  /** Label of the model that will answer, or OFFLINE when there is none. */
  get label(): string {
    return this.remote?.label ?? OFFLINE_LABEL;
  }

  /** Resolves the server status once and remembers it. */
  detect(): Promise<void> {
    this.status ??= fetchProviderStatus().then((status) => {
      if (status.available)
        this.remote = new RemoteProvider(status.id, status.label);
    });
    return this.status;
  }

  /** Interprets with the hosted model. Throws ProviderUnavailableError when none is configured. */
  async interpret(request: InterpretRequest): Promise<AIResult> {
    await this.detect();
    if (!this.remote)
      throw new ProviderUnavailableError("No hosted model is configured");
    const result = await this.remote.interpret(request);
    return { ...result, provider: this.remote.label };
  }
}

let shared: EngineerClient | null = null;

/** Returns the app-wide AI provider. */
export function getAIProvider(): EngineerClient {
  shared ??= new EngineerClient();
  return shared;
}
