import type { RocketConfig } from "../rocket/types";
import type { AIResult } from "./actions";

/** One earlier exchange, given to the model as context. */
export interface HistoryEntry {
  prompt: string;
  response: string;
}

/** A compact description of a simulated launch, used by AI repair. */
export interface MissionSummary {
  outcome: string;
  headline: string;
  problems: string[];
}

/** Everything a provider needs to interpret one instruction. */
export interface InterpretRequest {
  instruction: string;
  rocket: RocketConfig;
  history: HistoryEntry[];
  mode: "modify" | "repair";
  mission?: MissionSummary;
}

/**
 * A swappable interpreter that turns language into validated rocket actions.
 * Providers return data only; the caller decides whether and how to apply it.
 */
export interface AIProvider {
  readonly id: string;
  readonly label: string;
  interpret(request: InterpretRequest): Promise<AIResult>;
}
