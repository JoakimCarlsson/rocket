import { computeStats } from "../rocket/stats";
import type { RocketConfig } from "../rocket/types";
import type { InterpretRequest } from "./provider";

/** Summarises the rocket compactly so the model sees ids and key numbers. */
export function describeRocket(rocket: RocketConfig): string {
  const stats = computeStats(rocket);
  return JSON.stringify({
    name: rocket.name,
    destination: rocket.destination,
    tilt: rocket.tilt,
    stages: rocket.stages.map((s) => ({
      id: s.id,
      height: +s.height.toFixed(1),
      radius: +s.radius.toFixed(2),
      engines: {
        count: s.engine.count,
        size: +s.engine.size.toFixed(2),
        power: +s.engine.power.toFixed(1),
        style: s.engine.style,
      },
      color: s.color,
    })),
    boosters: rocket.boosters.map((b) => ({
      id: b.id,
      height: +b.height.toFixed(1),
      radius: +b.radius.toFixed(2),
      color: b.color,
    })),
    payload: rocket.payload,
    fins: rocket.fins,
    legs: rocket.legs,
    decorativeParts: rocket.decorativeParts,
    appearance: rocket.appearance,
    fictionalStats: stats,
  });
}

/** Builds the user turn for a hosted model from an interpret request. */
export function buildUserMessage(request: InterpretRequest): string {
  const history = request.history
    .slice(-6)
    .map((h, i) => `${i + 1}. player: ${h.prompt}\n   engineer: ${h.response}`)
    .join("\n");
  const parts = [
    `MODE: ${request.mode}`,
    `CURRENT ROCKET: ${describeRocket(request.rocket)}`,
    history ? `RECENT CHANGES:\n${history}` : "",
    request.mission
      ? `FICTIONAL MISSION RESULT: ${JSON.stringify(request.mission)}`
      : "",
    `PLAYER INSTRUCTION: ${request.instruction.slice(0, 500)}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}
