import type { AIResult } from "./actions";
import { LocalProvider } from "./local-provider";
import type { AIProvider, InterpretRequest } from "./provider";
import { RemoteProvider, fetchProviderStatus } from "./remote-provider";

/**
 * Provider used by the UI: prefers the hosted model when the server has one configured
 * and silently falls back to the local engineer when it is missing or fails.
 */
export class AutoProvider implements AIProvider {
  readonly id = "auto";
  private readonly local = new LocalProvider();
  private remote: RemoteProvider | null = null;
  private status: Promise<void> | null = null;

  /** Label of the provider that will currently answer. */
  get label(): string {
    return this.remote?.label ?? this.local.label;
  }

  /** Resolves the server status once and remembers it. */
  detect(): Promise<void> {
    this.status ??= fetchProviderStatus().then((status) => {
      if (status.available) this.remote = new RemoteProvider(status.id, status.label);
    });
    return this.status;
  }

  /**
   * Interprets with the best available provider. `provider` on the result names whoever
   * actually answered, so the UI never claims the hosted model did when it fell back.
   */
  async interpret(request: InterpretRequest): Promise<AIResult> {
    await this.detect();
    if (this.remote) {
      try {
        const result = await this.remote.interpret(request);
        if (result.actions.length > 0 || result.response) return { ...result, provider: this.remote.label };
        console.warn("Hosted model returned nothing usable; using the local engineer.");
      } catch (error) {
        console.warn("Hosted model failed; using the local engineer.", error);
      }
      return { ...(await this.local.interpret(request)), provider: `${this.local.label} (FALLBACK)` };
    }
    return { ...(await this.local.interpret(request)), provider: this.local.label };
  }
}

let shared: AutoProvider | null = null;

/** Returns the app-wide AI provider. */
export function getAIProvider(): AutoProvider {
  shared ??= new AutoProvider();
  return shared;
}
