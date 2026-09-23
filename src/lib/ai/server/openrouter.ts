import { SYSTEM_PROMPT, buildUserMessage } from "../prompt";
import type { InterpretRequest } from "../provider";
import type { ModelClient } from "./model-client";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "bytedance-seed/seed-2.0-mini";

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

const ACTION_FIELDS = {
  type: { type: "string" },
  name: nullableString,
  value: nullableString,
  target: nullableString,
  id: nullableString,
  ids: { type: ["array", "null"], items: { type: "string" } },
  kind: nullableString,
  attach: nullableString,
  position: nullableString,
  size: nullableString,
  style: nullableString,
  shape: nullableString,
  color: nullableString,
  count: nullableNumber,
  crew: nullableNumber,
  power: nullableNumber,
  height: nullableNumber,
  width: nullableNumber,
  radius: nullableNumber,
  degrees: nullableNumber,
};

/**
 * Loose envelope for strict structured outputs: every field is required but nullable.
 * It only guarantees parseable JSON; `validateModelOutput` does the real per-action checks
 * and drops the nulls.
 */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    response: { type: "string" },
    name: nullableString,
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: ACTION_FIELDS,
        required: Object.keys(ACTION_FIELDS),
        additionalProperties: false,
      },
    },
  },
  required: ["response", "name", "actions"],
  additionalProperties: false,
};

interface ChatCompletion {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
}

/** OpenRouter-backed model client using strict JSON-schema structured outputs. */
export class OpenRouterModelClient implements ModelClient {
  readonly id = "openrouter";
  readonly label: string;
  private readonly apiKey: string;
  private readonly model: string;

  /** Creates a client for the configured OpenRouter model. */
  constructor(apiKey: string, model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
    this.label = model.split("/").pop()!.toUpperCase().replace(/-/g, " ");
  }

  /** Asks the model for rocket actions and returns the parsed JSON envelope. */
  async complete(request: InterpretRequest): Promise<unknown> {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "ROCKET.AI",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4000,
        reasoning: { effort: "low" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(request) },
        ],
        response_format: { type: "json_schema", json_schema: { name: "rocket_actions", strict: true, schema: OUTPUT_SCHEMA } },
        provider: { require_parameters: true },
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const message = ((await response.json()) as ChatCompletion).choices?.[0]?.message;
    if (message?.refusal) return { actions: [], response: "Mission control declined that one. Try a different change." };
    return JSON.parse(message?.content ?? "{}");
  }
}

/** Returns the configured server model, or null when no OpenRouter key is present. */
export function createModelClient(): ModelClient | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  return apiKey ? new OpenRouterModelClient(apiKey) : null;
}
