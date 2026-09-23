import { createRng, hashString } from "../rocket/random";
import { validateModelOutput, type AIResult } from "./actions";
import { interpretLocally } from "./local-interpreter";
import type { AIProvider, InterpretRequest } from "./provider";

/** Pause that makes the local engineer feel like it is thinking. */
const THINKING_MS = 420;

/** Offline provider backed by the keyword interpreter. Always available. */
export class LocalProvider implements AIProvider {
  readonly id = "local";
  readonly label = "LOCAL ENGINEER";

  /** Interprets the instruction with local rules and validates the result like any model output. */
  async interpret(request: InterpretRequest): Promise<AIResult> {
    const seed = hashString(`${request.instruction}|${request.rocket.seed}|${request.history.length}|${Date.now()}`);
    const raw = interpretLocally(request.instruction, request.rocket, createRng(seed), {
      mode: request.mode,
      mission: request.mission,
    });
    await new Promise((resolve) => setTimeout(resolve, THINKING_MS));
    return validateModelOutput(raw, this.id);
  }
}
