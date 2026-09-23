import { z } from "zod";
import { createModelClient } from "@/lib/ai/server/openrouter";
import { parseRocket } from "@/lib/rocket/schema";

const requestSchema = z.object({
  instruction: z.string().max(1000),
  rocket: z.unknown(),
  history: z.array(z.object({ prompt: z.string().max(1000), response: z.string().max(500) })).max(20).default([]),
  mode: z.enum(["modify", "repair"]).default("modify"),
  mission: z
    .object({ outcome: z.string().max(40), headline: z.string().max(120), problems: z.array(z.string().max(200)).max(10) })
    .optional(),
});

/** Reports whether a hosted model is configured so the client can pick a provider. */
export async function GET() {
  const client = createModelClient();
  return Response.json(client ? { available: true, id: client.id, label: client.label } : { available: false, id: "none", label: "" });
}

/** Interprets one instruction with the hosted model and returns its raw JSON for client-side validation. */
export async function POST(request: Request) {
  const client = createModelClient();
  if (!client) return Response.json({ error: "no_provider" }, { status: 503 });
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const rocket = parseRocket(body.data.rocket);
  if (!rocket) return Response.json({ error: "bad_rocket" }, { status: 400 });
  try {
    const output = await client.complete({ ...body.data, rocket });
    return Response.json(output);
  } catch (error) {
    console.error("AI provider failed", error);
    return Response.json({ error: "provider_failed" }, { status: 502 });
  }
}
