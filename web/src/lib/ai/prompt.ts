import type { Analysis } from "../physics/api";
import type { RocketConfig } from "../rocket/types";
import type { InterpretRequest } from "./provider";

/** Summarises the rocket and its server analysis compactly so the model sees ids and key numbers. */
export function describeRocket(
  rocket: RocketConfig,
  analysis: Analysis,
): string {
  return JSON.stringify({
    name: rocket.name,
    destination: rocket.destination,
    tilt: rocket.tilt,
    stages: rocket.stages.map((s) => ({
      id: s.id,
      height: +s.height.toFixed(1),
      radius: +s.radius.toFixed(2),
      propellant: s.propellant,
      engines: {
        count: s.engine.count,
        size: +s.engine.size.toFixed(2),
        power: +s.engine.power.toFixed(1),
        style: s.engine.style,
        gimbal: s.engine.gimbal,
      },
      color: s.color,
    })),
    boosters: rocket.boosters.map((b) => ({
      id: b.id,
      height: +b.height.toFixed(1),
      radius: +b.radius.toFixed(2),
      propellant: b.propellant,
      gimbal: b.engine.gimbal,
      color: b.color,
    })),
    payload: rocket.payload,
    fins: rocket.fins,
    legs: rocket.legs,
    decorativeParts: rocket.decorativeParts,
    appearance: rocket.appearance,
    fictionalStats: analysis.stats,
    staging: analysis.staging.map((p) => ({
      burn: p.label,
      deltaV: Math.round(p.deltaV),
      twr: +p.twr.toFixed(2),
    })),
  });
}

/** Builds the user turn for a hosted model from an interpret request and the rocket's analysis. */
export function buildUserMessage(
  request: InterpretRequest,
  analysis: Analysis,
): string {
  const history = request.history
    .slice(-6)
    .map((h, i) => `${i + 1}. player: ${h.prompt}\n   engineer: ${h.response}`)
    .join("\n");
  const parts = [
    `MODE: ${request.mode}`,
    `CURRENT ROCKET: ${describeRocket(request.rocket, analysis)}`,
    history ? `RECENT CHANGES:\n${history}` : "",
    request.mission
      ? `FICTIONAL MISSION RESULT: ${JSON.stringify(request.mission)}`
      : "",
    `PLAYER INSTRUCTION: ${request.instruction.slice(0, 500)}`,
  ];
  return parts.filter(Boolean).join("\n\n");
}
